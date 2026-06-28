/** `list` command: show the app catalog and which apps are installed. */
import { loadConfig } from "../config.js";
import { CATALOG } from "../catalog.js";
import { log } from "../util/log.js";

export async function listCommand(opts: { config?: string }): Promise<void> {
  const cfg = loadConfig(opts.config);
  const installed = new Set(cfg.installed);

  log.step("Core (always installed)");
  console.log("  caddy        reverse proxy + per-service .local TLS");
  console.log("  portainer    docker management UI");

  log.step("Catalog (home-stack install <name>)");
  for (const app of Object.values(CATALOG)) {
    const mark = installed.has(app.name) ? "[installed]" : "[ ]";
    console.log(`  ${mark.padEnd(12)} ${app.name.padEnd(14)} ${app.description}`);
  }
}
