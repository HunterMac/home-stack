/**
 * App catalog loader.
 *
 * Each installable app lives in `catalog/apps/<name>.ts` and exports an
 * `AppDefinition`. This module collects them into the CATALOG registry used
 * by compose, Caddy, mDNS and `hstack install`.
 *
 * To add an app: create `catalog/apps/my-app.ts` exporting `app`, then import
 * it below. Core infrastructure (Caddy + Portainer) is NOT in the catalog.
 */
import type { AppDefinition } from "./types.js";
import { app as homeAssistant } from "./apps/home-assistant.js";
import { app as jellyfin } from "./apps/jellyfin.js";
import { app as filebrowser } from "./apps/filebrowser.js";
import { app as ollama } from "./apps/ollama.js";
import { app as uptimeKuma } from "./apps/uptime-kuma.js";

export type { AppContext, AppDefinition, ComposeService, SeedFile } from "./types.js";

/** All catalog apps — add new imports above and append here. */
const APPS: AppDefinition[] = [homeAssistant, jellyfin, filebrowser, ollama, uptimeKuma];

function buildCatalog(apps: AppDefinition[]): Record<string, AppDefinition> {
  const catalog: Record<string, AppDefinition> = {};
  for (const def of apps) {
    if (def.name !== def.name.trim() || catalog[def.name]) {
      throw new Error(`catalog: duplicate or invalid app name '${def.name}'`);
    }
    if (def.name !== def.name.toLowerCase()) {
      throw new Error(`catalog: app name must be lowercase dns-safe: '${def.name}'`);
    }
    catalog[def.name] = def;
  }
  return catalog;
}

export const CATALOG = buildCatalog(APPS);

export function getApp(name: string): AppDefinition | undefined {
  return CATALOG[name];
}

export function catalogNames(): string[] {
  return Object.keys(CATALOG);
}
