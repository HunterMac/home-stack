/**
 * Generic compose service builder for user-defined custom apps.
 *
 * The stack-wide shared volume (host shared/ → /shared) is appended automatically
 * by renderCompose() for every service — including custom apps.
 */
import type { AppContext } from "../catalog/index.js";
import type { CustomApp } from "../config.js";
import type { ComposeService } from "../catalog/index.js";

export function buildCustomService(app: CustomApp, ctx: AppContext): ComposeService {
  const volumes: string[] = [
    `${ctx.paths.appdata}/${app.name}:/data`,
    `${ctx.paths.config}/${app.name}:/config`,
    ...(app.volumes ?? []),
  ];

  const environment: Record<string, string> = {
    TZ: ctx.timezone,
    PUID: String(ctx.puid),
    PGID: String(ctx.pgid),
    ...(app.env ?? {}),
  };

  return {
    image: app.image,
    container_name: app.name,
    restart: "unless-stopped",
    networks: ["homestack"],
    volumes,
    environment,
  };
}
