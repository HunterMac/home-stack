/**
 * Configuration schema + loader for home-stack.
 *
 * Reads `home-stack.config.json` (override with --config), validates it with
 * zod, fills defaults and derives runtime paths + the effective service list.
 *
 * Installable apps live in the fixed catalog (src/catalog.ts). The only state
 * the user keeps here is which catalog apps are `installed`. Core infrastructure
 * (Caddy + Portainer) is always present and is not listed in `installed`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { type AppContext, getApp, catalogNames } from "./catalog.js";

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

  /** Catalog apps to deploy. Managed via `home-stack install/uninstall`. */
  installed: z.array(z.string()).default([]),

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

/** Pre-installed core service that also gets a Caddy route + mDNS name. */
const CORE_SERVICES: Service[] = [
  { name: "portainer", upstreamHost: "portainer", upstreamPort: 9000 },
];

export interface ResolvedConfig extends Config {
  /** Resolved absolute config file path (for persistence). */
  configPath: string;
  /** Effective routable services: core + installed catalog apps. */
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

  const installedServices: Service[] = installed.map((name) => {
    const app = getApp(name)!;
    return { name: app.name, upstreamHost: app.upstreamHost ?? app.name, upstreamPort: app.upstreamPort };
  });

  const root = cfg.storage.root;
  return {
    ...cfg,
    configPath: path,
    activeServices: [...CORE_SERVICES, ...installedServices],
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

/** Build the context catalog builders consume. */
export function appContext(cfg: ResolvedConfig): AppContext {
  return {
    paths: cfg.paths,
    timezone: cfg.timezone,
    puid: cfg.puid ?? 1000,
    pgid: cfg.pgid ?? 1000,
  };
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
