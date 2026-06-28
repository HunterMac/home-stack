import type { AppDefinition } from "../types.js";
import { idEnv } from "../helpers.js";

/** Default settings for the s6 image; root must match a mounted path (see compose volumes). */
function filebrowserSettings(): string {
  return (
    JSON.stringify(
      {
        port: 80,
        baseURL: "",
        address: "",
        log: "stdout",
        database: "/database/filebrowser.db",
        root: "/srv",
      },
      null,
      2,
    ) + "\n"
  );
}

export const app: AppDefinition = {
  name: "filebrowser",
  description: "File Browser - web file manager",
  upstreamPort: 80,
  dirs: (ctx) => [`${ctx.paths.appdata}/filebrowser/database`],
  compose: (ctx) => ({
    image: "filebrowser/filebrowser:s6",
    container_name: "filebrowser",
    restart: "unless-stopped",
    networks: ["homestack"],
    volumes: [
      `${ctx.paths.appdata}/filebrowser/database:/database`,
      `${ctx.paths.config}/filebrowser:/config`,
      // Image defaults to root /srv; mount shared here too for installs that already have that setting.
      `${ctx.paths.shared}:/srv`,
    ],
    environment: idEnv(ctx),
  }),
  seed: (ctx) => [
    {
      path: `${ctx.paths.config}/filebrowser/settings.json`,
      content: filebrowserSettings(),
    },
  ],
  note:
    "Browse /srv (stack shared files). Create subfolders as needed. " +
    "Login: admin — password in `docker logs filebrowser`.",
};
