/**
 * Step: create the on-disk directory structure with separated persistent data.
 *
 *   /srv/docker/
 *     compose/    docker-compose.yml (generated)
 *     config/     per-service config (Caddyfile, HA config, restic password)
 *     appdata/    per-service persistent runtime data (the "state")
 *     backups/    local restic repository
 *
 * Keeping config and appdata apart makes config-only vs full restores trivial.
 */
import { ensureDir, chownRecursive } from "../util/fs.js";
import { log } from "../util/log.js";
import { appContext, type ResolvedConfig } from "../config.js";
import { getApp } from "../catalog.js";

export async function structureStep(cfg: ResolvedConfig): Promise<void> {
  log.step("Directory structure");
  const { compose, config, appdata, backups } = cfg.paths;

  for (const d of [compose, config, appdata, backups]) ensureDir(d);

  // Per-service data + config folders for every active service.
  for (const svc of cfg.activeServices) {
    ensureDir(`${appdata}/${svc.name}`);
    ensureDir(`${config}/${svc.name}`);
  }

  // Extra dirs declared by installed catalog apps (e.g. jellyfin media/cache).
  const ctx = appContext(cfg);
  for (const name of cfg.installed) {
    const app = getApp(name);
    for (const dir of app?.dirs?.(ctx) ?? []) ensureDir(dir);
  }

  // Custom apps: standard appdata + config dirs (volumes in buildCustomService).
  for (const customApp of cfg.customApps) {
    ensureDir(`${appdata}/${customApp.name}`);
    ensureDir(`${config}/${customApp.name}`);
  }

  // Core service folders that always exist regardless of toggles.
  ensureDir(`${appdata}/caddy/data`);
  ensureDir(`${appdata}/caddy/config`);
  ensureDir(`${config}/caddy`);
  ensureDir(`${config}/restic`, 0o700);

  // Hand ownership of appdata + config to the stack user (root keeps the root).
  if (cfg.puid !== null && cfg.pgid !== null) {
    await chownRecursive(appdata, cfg.puid, cfg.pgid);
    await chownRecursive(config, cfg.puid, cfg.pgid);
    log.ok(`chowned appdata + config to ${cfg.user} (${cfg.puid}:${cfg.pgid})`);
  }
}
