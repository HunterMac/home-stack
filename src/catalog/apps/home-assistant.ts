import type { AppDefinition } from "../types.js";
import { idEnv } from "../helpers.js";
import { renderHomeAssistantConfig } from "../../templates/homeassistant.js";

export const app: AppDefinition = {
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
};
