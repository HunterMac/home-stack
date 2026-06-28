import type { AppContext } from "./types.js";

/** Standard TZ + PUID/PGID env for images that honour LinuxServer-style vars. */
export function idEnv(ctx: AppContext): Record<string, string> {
  return { TZ: ctx.timezone, PUID: String(ctx.puid), PGID: String(ctx.pgid) };
}
