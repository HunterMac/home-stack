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
  /** DNS-safe id matching the Docker image slug. Also compose service + `<name>.local`. */
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
