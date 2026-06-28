/**
 * Configuration schema + loader for home-stack.
 *
 * Reads `home-stack.config.json` (override with --config), validates it with
 * zod, fills defaults and derives runtime paths + the effective service list.
 *
 * Installable apps live in the catalog (`src/catalog/apps/`). The only state
 * the user keeps here is which catalog apps are `installed`. Core infrastructure
 * (Caddy + Portainer) is always present and is not listed in `installed`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { type AppContext, getApp, catalogNames } from "./catalog/index.js";

/** A routable service: how Caddy + mDNS reach it. */
export interface Service {
  name: string;
  upstreamHost: string;
  upstreamPort: number;
}

export const ConfigSchema = z.object({
  /** Non-root owner of the stack; auto-detected from SUDO_USER when empty. */
  user: z.string().default(""),
  timezone: z.string().default("Europe/Warsaw"),
  /** Unix uid/gid applied to appdata + containers; auto-detected when null. */
  puid: z.number().int().nullable().default(null),
  pgid: z.number().int().nullable().default(null),

  storage: z
    .object({
      root: z.string().default("/srv/docker"),
      /** 1 = ext4 (Phase #1), 2 = btrfs subvolumes (Phase #2). */
      phase: z.union([z.literal(1), z.literal(2)]).default(1),
      /** Optional dedicated block device, e.g. "/dev/sda1". Empty = use current FS. */
      device: z.string().default(""),
    })
    .default({}),

  network: z
    .object({
      domainSuffix: z.string().default("local"),
      tls: z.union([z.literal("internal"), z.literal("off")]).default("internal"),
    })
    .default({}),

  /** Catalog apps to deploy. Managed via `hstack install/uninstall`. */
  installed: z.array(z.string()).default([]),

  /**
   * User-defined custom apps (not in the catalog). Added automatically when
   * the user confirms an `hstack install <unknown>` prompt, or hand-edited.
   * Each gets a generic compose service, Caddy route, mDNS hostname and
   * standard appdata/config folders.
   */
  customApps: z
    .array(
      z.object({
        /** DNS-safe id; also the compose service name + `<name>.local`. */
        name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase dns-safe name"),
        /** Full Docker image reference, e.g. "ollama/ollama:latest". */
        image: z.string().min(1),
        /** Container port Caddy proxies to. */
        port: z.number().int().positive(),
        /** Extra environment vars injected into the container. */
        env: z.record(z.string()).optional(),
        /** Extra volume mounts in docker-compose "host:container" notation. */
        volumes: z.array(z.string()).optional(),
      }),
    )
    .default([]),

  /**
   * Optional shared HTTP basic-auth gate, enforced by Caddy in front of
   * selected services. The password is stored plaintext here (this file is
   * gitignored); Caddy needs a bcrypt hash, generated for it at deploy time.
   */
  auth: z
    .object({
      enabled: z.boolean().default(false),
      username: z.string().default("admin"),
      password: z.string().default(""),
      /** Protect the core Portainer UI (it also has its own login). */
      protectCore: z.boolean().default(true),
      /** Installed apps to also gate, e.g. ["jellyfin"]. */
      apps: z.array(z.string()).default([]),
    })
    .default({}),

  /**
   * Public exposure settings. Required before any service can be made `public`.
   * `*.local` is LAN-only; public reachability needs a real domain + TLS.
   */
  public: z
    .object({
      /** Public base domain, e.g. "home.example.com" -> jellyfin.home.example.com. */
      baseDomain: z.string().default(""),
      /** Email for Let's Encrypt registration (recommended). */
      tlsEmail: z.string().default(""),
    })
    .default({}),

  /**
   * Per-service exposure. Anything absent defaults to "local" (LAN only).
   * Managed via `home-stack service visibility <name> <local|public>`.
   */
  visibility: z
    .record(z.union([z.literal("local"), z.literal("public")]))
    .default({}),

  backup: z
    .object({
      repo: z.string().default("/srv/docker/backups/restic"),
      passwordFile: z.string().default("/srv/docker/config/restic/password"),
      paths: z
        .array(z.string())
        .default(["/srv/docker/config", "/srv/docker/appdata", "/srv/docker/compose"]),
      keepDaily: z.number().int().default(7),
      keepWeekly: z.number().int().default(4),
      keepMonthly: z.number().int().default(6),
      schedule: z.string().default("*-*-* 03:30:00"),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type CustomApp = Config["customApps"][number];

/** Regex for DNS-safe app names (must match customApps schema). */
export const APP_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

/** Reusable schema for a single custom app entry. */
export const CustomAppSchema = z.object({
  name: z.string().regex(APP_NAME_REGEX, "lowercase dns-safe name"),
  image: z.string().min(1),
  port: z.number().int().positive(),
  env: z.record(z.string()).optional(),
  volumes: z.array(z.string()).optional(),
});

/** Core infrastructure names — never allowed as custom apps. */
const CORE_RESERVED_NAMES = new Set(["caddy", "portainer"]);

/** Validate a proposed custom app name matches the DNS-safe format. */
export function validateCustomAppName(name: string): void {
  if (!APP_NAME_REGEX.test(name)) {
    throw new Error(
      `invalid app name '${name}': must be lowercase, dns-safe ` +
        `(letters, digits, hyphens; e.g. ollama, home-assistant)`,
    );
  }
}

/** Reject custom app names that collide with catalog, core or installed apps. */
export function assertCustomAppNameAllowed(
  name: string,
  cfg: Pick<Config, "installed" | "customApps">,
): void {
  validateCustomAppName(name);
  if (CORE_RESERVED_NAMES.has(name)) {
    throw new Error(`'${name}' is reserved for core infrastructure`);
  }
  if (getApp(name)) {
    throw new Error(`'${name}' is a catalog app — use: hstack install ${name}`);
  }
  if (cfg.installed.includes(name)) {
    throw new Error(
      `'${name}' is already installed as a catalog app; ` +
        `remove it first or choose a different custom app name`,
    );
  }
}

/** Pre-installed core service that also gets a Caddy route + mDNS name. */
const CORE_SERVICES: Service[] = [
  { name: "portainer", upstreamHost: "portainer", upstreamPort: 9000 },
];

export interface ResolvedConfig extends Config {
  /** Resolved absolute config file path (for persistence). */
  configPath: string;
  /** Effective routable services: core + installed catalog apps + custom apps. */
  activeServices: Service[];
  paths: {
    root: string;
    compose: string;
    appdata: string;
    config: string;
    backups: string;
  };
}

export function loadConfig(configPath?: string): ResolvedConfig {
  const path = resolve(configPath ?? "home-stack.config.json");
  let raw: unknown = {};
  if (existsSync(path)) {
    raw = JSON.parse(readFileSync(path, "utf8"));
  }
  const cfg = ConfigSchema.parse(raw);

  // De-dupe installed + validate against the catalog.
  const installed = [...new Set(cfg.installed)];
  const unknown = installed.filter((n) => !getApp(n));
  if (unknown.length) {
    throw new Error(
      `unknown app(s) in config.installed: ${unknown.join(", ")}. ` +
        `Available: ${catalogNames().join(", ")}`,
    );
  }
  cfg.installed = installed;

  // Validate custom apps: format, no shadowing of catalog/core/installed.
  for (const app of cfg.customApps) {
    assertCustomAppNameAllowed(app.name, cfg);
  }
  const customNameList = cfg.customApps.map((a) => a.name);
  const dupCustom = customNameList.filter((n, i) => customNameList.indexOf(n) !== i);
  if (dupCustom.length) {
    throw new Error(`duplicate custom app name(s): ${[...new Set(dupCustom)].join(", ")}`);
  }

  // Validate auth.
  if (cfg.auth.enabled && !cfg.auth.password) {
    throw new Error("auth.enabled is true but auth.password is empty");
  }
  // Validate auth (catalog + custom apps).
  const customNames = new Set(cfg.customApps.map((a) => a.name));
  const knownAuthNames = new Set<string>([...catalogNames(), ...customNames]);
  const unknownAuth = cfg.auth.apps.filter((n) => !knownAuthNames.has(n));
  if (unknownAuth.length) {
    throw new Error(
      `unknown app(s) in auth.apps: ${unknownAuth.join(", ")}. ` +
        `Known: ${[...knownAuthNames].join(", ")}`,
    );
  }

  // Validate visibility (must include custom app names too).
  const knownNames = new Set<string>(["portainer", ...catalogNames(), ...customNames]);
  const unknownVis = Object.keys(cfg.visibility).filter((n) => !knownNames.has(n));
  if (unknownVis.length) {
    throw new Error(
      `unknown service(s) in visibility: ${unknownVis.join(", ")}. ` +
        `Known: ${[...knownNames].join(", ")}`,
    );
  }
  const anyPublic = Object.values(cfg.visibility).some((v) => v === "public");
  if (anyPublic && !cfg.public.baseDomain) {
    throw new Error("a service is set to public but public.baseDomain is empty");
  }

  const installedServices: Service[] = installed.map((name) => {
    const app = getApp(name)!;
    return { name: app.name, upstreamHost: app.upstreamHost ?? app.name, upstreamPort: app.upstreamPort };
  });

  const customServices: Service[] = cfg.customApps.map((a) => ({
    name: a.name,
    upstreamHost: a.name,
    upstreamPort: a.port,
  }));

  const root = cfg.storage.root;
  return {
    ...cfg,
    configPath: path,
    activeServices: [...CORE_SERVICES, ...installedServices, ...customServices],
    paths: {
      root,
      compose: `${root}/compose`,
      appdata: `${root}/appdata`,
      config: `${root}/config`,
      backups: `${root}/backups`,
    },
  };
}

export function serviceFqdn(svc: Service, cfg: ResolvedConfig): string {
  return `${svc.name}.${cfg.network.domainSuffix}`;
}

/** Whether a given service name should sit behind the shared basic-auth gate. */
export function isProtected(cfg: ResolvedConfig, name: string): boolean {
  if (!cfg.auth.enabled) return false;
  if (name === "portainer") return cfg.auth.protectCore;
  return cfg.auth.apps.includes(name);
}

/** True if the service is exposed publicly (default: local/LAN only). */
export function isPublic(cfg: ResolvedConfig, name: string): boolean {
  return cfg.visibility[name] === "public";
}

/** Public hostname for a service, e.g. jellyfin.home.example.com. */
export function publicFqdn(cfg: ResolvedConfig, name: string): string {
  return `${name}.${cfg.public.baseDomain}`;
}

/** Persist a single service's visibility back to the config file. */
export function saveVisibility(
  cfg: ResolvedConfig,
  name: string,
  mode: "local" | "public",
): void {
  let raw: Record<string, unknown> = {};
  if (existsSync(cfg.configPath)) {
    raw = JSON.parse(readFileSync(cfg.configPath, "utf8"));
  }
  const visibility = { ...(raw.visibility as Record<string, string> | undefined), [name]: mode };
  raw.visibility = visibility;
  writeFileSync(cfg.configPath, JSON.stringify(raw, null, 2) + "\n");
  cfg.visibility = visibility as Config["visibility"];
}

/** Build the context catalog builders consume. */
export function appContext(cfg: ResolvedConfig): AppContext {
  return {
    paths: cfg.paths,
    timezone: cfg.timezone,
    puid: cfg.puid ?? 1000,
    pgid: cfg.pgid ?? 1000,
  };
}

/** Persist a new custom app entry to the config file. */
export function saveCustomApp(cfg: ResolvedConfig, app: CustomApp): void {
  const parsed = CustomAppSchema.parse(app);
  assertCustomAppNameAllowed(parsed.name, cfg);
  let raw: Record<string, unknown> = {};
  if (existsSync(cfg.configPath)) {
    raw = JSON.parse(readFileSync(cfg.configPath, "utf8"));
  }
  const existing = (raw.customApps as CustomApp[] | undefined) ?? [];
  const without = existing.filter((a) => a.name !== parsed.name);
  raw.customApps = [...without, parsed];
  writeFileSync(cfg.configPath, JSON.stringify(raw, null, 2) + "\n");
}

/** Remove a custom app entry from the config file. */
export function removeCustomApp(cfg: ResolvedConfig, name: string): void {
  let raw: Record<string, unknown> = {};
  if (existsSync(cfg.configPath)) {
    raw = JSON.parse(readFileSync(cfg.configPath, "utf8"));
  }
  const existing = (raw.customApps as CustomApp[] | undefined) ?? [];
  raw.customApps = existing.filter((a) => a.name !== name);
  writeFileSync(cfg.configPath, JSON.stringify(raw, null, 2) + "\n");
}

/** Persist the `installed` list back to the config file (creating it if needed). */
export function saveInstalled(cfg: ResolvedConfig, installed: string[]): void {
  let raw: Record<string, unknown> = {};
  if (existsSync(cfg.configPath)) {
    raw = JSON.parse(readFileSync(cfg.configPath, "utf8"));
  }
  raw.installed = [...new Set(installed)].sort();
  writeFileSync(cfg.configPath, JSON.stringify(raw, null, 2) + "\n");
  cfg.installed = raw.installed as string[];
}
