/**
 * Fixed catalog of installable apps.
 *
 * Core infrastructure (Caddy reverse proxy + Portainer) is NOT in here - it is
 * always deployed by the compose generator. The catalog only lists optional
 * apps a user can add via `home-stack install <name>`.
 *
 * To add a new app: add one entry below. The compose service, Caddy route,
 * mDNS hostname and on-disk folders are all derived from it automatically.
 */
import { renderHomeAssistantConfig } from "./templates/homeassistant.js";

/** Minimal runtime context catalog builders need. */
export interface AppContext {
  paths: {
    root: string;
    compose: string;
    appdata: string;
    config: string;
    backups: string;
  };
  timezone: string;
  puid: number;
  pgid: number;
}

/** A docker-compose service object (loosely typed). */
export type ComposeService = Record<string, unknown>;

/** A seed file written once on first install (never overwritten afterwards). */
export interface SeedFile {
  path: string;
  content: string;
}

export interface AppDefinition {
  /** DNS-safe id; also the compose service name + `<name>.local` hostname. */
  name: string;
  description: string;
  /** Host Caddy proxies to (defaults to `name`). */
  upstreamHost?: string;
  /** Container port Caddy proxies to. */
  upstreamPort: number;
  /** Extra dirs to pre-create besides appdata/<name> and config/<name>. */
  dirs?: (ctx: AppContext) => string[];
  /** Build the compose service definition. */
  compose: (ctx: AppContext) => ComposeService;
  /** Config files seeded once on first install. */
  seed?: (ctx: AppContext) => SeedFile[];
  /** One-liner shown after install. */
  note?: string;
}

function idEnv(ctx: AppContext): Record<string, string> {
  return { TZ: ctx.timezone, PUID: String(ctx.puid), PGID: String(ctx.pgid) };
}

export const CATALOG: Record<string, AppDefinition> = {
  homeassistant: {
    name: "homeassistant",
    description: "Home Assistant - open-source home automation hub",
    upstreamPort: 8123,
    compose: (ctx) => ({
      image: "ghcr.io/home-assistant/home-assistant:stable",
      container_name: "homeassistant",
      restart: "unless-stopped",
      networks: ["homestack"],
      volumes: [
        `${ctx.paths.config}/homeassistant:/config`,
        "/etc/localtime:/etc/localtime:ro",
        "/run/dbus:/run/dbus:ro",
      ],
      environment: idEnv(ctx),
    }),
    seed: (ctx) => [
      {
        path: `${ctx.paths.config}/homeassistant/configuration.yaml`,
        content: renderHomeAssistantConfig(ctx.timezone),
      },
      { path: `${ctx.paths.config}/homeassistant/automations.yaml`, content: "[]\n" },
      { path: `${ctx.paths.config}/homeassistant/scenes.yaml`, content: "[]\n" },
      { path: `${ctx.paths.config}/homeassistant/scripts.yaml`, content: "[]\n" },
    ],
    note: "Finish onboarding in the browser; HA is pre-configured to trust the Caddy proxy.",
  },

  jellyfin: {
    name: "jellyfin",
    description: "Jellyfin - free software media server",
    upstreamPort: 8096,
    dirs: (ctx) => [
      `${ctx.paths.appdata}/jellyfin/cache`,
      `${ctx.paths.appdata}/jellyfin/media`,
    ],
    compose: (ctx) => ({
      image: "jellyfin/jellyfin:latest",
      container_name: "jellyfin",
      restart: "unless-stopped",
      networks: ["homestack"],
      volumes: [
        `${ctx.paths.config}/jellyfin:/config`,
        `${ctx.paths.appdata}/jellyfin/cache:/cache`,
        `${ctx.paths.appdata}/jellyfin/media:/media`,
      ],
      environment: idEnv(ctx),
      // For hardware transcoding on the Pi, uncomment in compose.ts:
      //   devices: ["/dev/dri:/dev/dri"]
    }),
    note: "Add media under /srv/docker/appdata/jellyfin/media, then add libraries in the UI.",
  },

  "uptime-kuma": {
    name: "uptime-kuma",
    description: "Uptime Kuma - self-hosted uptime monitoring",
    upstreamPort: 3001,
    compose: (ctx) => ({
      image: "louislam/uptime-kuma:1",
      container_name: "uptime-kuma",
      restart: "unless-stopped",
      networks: ["homestack"],
      volumes: [`${ctx.paths.appdata}/uptime-kuma:/app/data`],
      environment: { TZ: ctx.timezone },
    }),
  },
};

export function getApp(name: string): AppDefinition | undefined {
  return CATALOG[name];
}

export function catalogNames(): string[] {
  return Object.keys(CATALOG);
}
