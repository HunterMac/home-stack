import type { AppDefinition } from "../types.js";
import { idEnv } from "../helpers.js";

export const app: AppDefinition = {
  name: "filebrowser",
  description: "File Browser - web file manager",
  upstreamPort: 80,
  dirs: (ctx) => [
    `${ctx.paths.appdata}/filebrowser/srv`,
    `${ctx.paths.appdata}/filebrowser/database`,
  ],
  compose: (ctx) => ({
    // s6 image honours PUID/PGID — matches appdata/config ownership from structureStep.
    image: "filebrowser/filebrowser:s6",
    container_name: "filebrowser",
    restart: "unless-stopped",
    networks: ["homestack"],
    volumes: [
      `${ctx.paths.appdata}/filebrowser/srv:/srv`,
      `${ctx.paths.appdata}/filebrowser/database:/database`,
      `${ctx.paths.config}/filebrowser:/config`,
    ],
    environment: idEnv(ctx),
  }),
  note:
    "Files to browse: appdata/filebrowser/srv. Login: admin — password in " +
    "`docker logs filebrowser` (change it in Settings immediately).",
};
