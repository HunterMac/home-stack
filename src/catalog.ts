/**
 * Fixed catalog of installable apps.
 *
 * Core infrastructure (Caddy + Portainer) is NOT here — always deployed.
 * Catalog apps are added via `hstack install <name>`.
 *
 * Naming convention: `name` = Docker image slug (e.g. "home-assistant", "ollama").
 *
 * To add a new app: one entry below. Compose service, Caddy route, mDNS hostname
 * and on-disk folders are all derived automatically.
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
  /** DNS-safe id matching the Docker image slug. Also the compose service name
   *  and `<name>.local` mDNS hostname. */
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
  "home-assistant": {
    name: "home-assistant",
    description: "Home Assistant - open-source home automation hub",
    upstreamPort: 8123,
    compose: (ctx) => ({
      image: "ghcr.io/home-assistant/home-assistant:stable",
      container_name: "home-assistant",
      restart: "unless-stopped",
      networks: ["homestack"],
      volumes: [
        `${ctx.paths.config}/home-assistant:/config`,
        "/etc/localtime:/etc/localtime:ro",
        "/run/dbus:/run/dbus:ro",
      ],
      environment: idEnv(ctx),
    }),
    seed: (ctx) => [
      {
        path: `${ctx.paths.config}/home-assistant/configuration.yaml`,
        content: renderHomeAssistantConfig(ctx.timezone),
      },
      { path: `${ctx.paths.config}/home-assistant/automations.yaml`, content: "[]\n" },
      { path: `${ctx.paths.config}/home-assistant/scenes.yaml`, content: "[]\n" },
      { path: `${ctx.paths.config}/home-assistant/scripts.yaml`, content: "[]\n" },
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
    }),
    note: "Add media under /srv/docker/appdata/jellyfin/media, then add libraries in the UI.",
  },

  ollama: {
    name: "ollama",
    description: "Ollama - run LLMs locally (API on port 11434)",
    upstreamPort: 11434,
    dirs: (ctx) => [`${ctx.paths.appdata}/ollama`],
    compose: (ctx) => ({
      image: "ollama/ollama:latest",
      container_name: "ollama",
      restart: "unless-stopped",
      networks: ["homestack"],
      volumes: [`${ctx.paths.appdata}/ollama:/root/.ollama`],
      environment: { TZ: ctx.timezone, OLLAMA_HOST: "0.0.0.0:11434" },
    }),
    note:
      "Pull a model: docker exec ollama ollama pull llama3.2. " +
      "API at https://ollama.local — models live under appdata/ollama (can be large).",
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
