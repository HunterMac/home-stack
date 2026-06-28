import type { AppDefinition } from "../types.js";

export const app: AppDefinition = {
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
};
