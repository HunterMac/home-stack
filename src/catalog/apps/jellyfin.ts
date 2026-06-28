import type { AppDefinition } from "../types.js";
import { idEnv } from "../helpers.js";

export const app: AppDefinition = {
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
};
