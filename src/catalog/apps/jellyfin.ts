import type { AppDefinition } from "../types.js";
import { idEnv } from "../helpers.js";

export const app: AppDefinition = {
  name: "jellyfin",
  description: "Jellyfin - free software media server",
  upstreamPort: 8096,
  dirs: (ctx) => [
    `${ctx.paths.shared}/media`,
    `${ctx.paths.appdata}/jellyfin/cache`,
  ],
  compose: (ctx) => ({
    image: "jellyfin/jellyfin:latest",
    container_name: "jellyfin",
    restart: "unless-stopped",
    networks: ["homestack"],
    volumes: [
      `${ctx.paths.config}/jellyfin:/config`,
      `${ctx.paths.appdata}/jellyfin/cache:/cache`,
    ],
    environment: idEnv(ctx),
  }),
  note: "Add library folder /shared/media in the Jellyfin UI (this app creates that subfolder on install).",
};
