/** `setup` command: run every provisioning step in order. Idempotent. */
import { loadConfig, saveInstalled } from "../config.js";
import { getApp, catalogNames } from "../catalog/index.js";
import { requireRoot, requireLinux, resolveUser } from "../util/system.js";
import { log, die } from "../util/log.js";
import { systemStep } from "../steps/system.js";
import { storageStep } from "../steps/storage.js";
import { dockerStep } from "../steps/docker.js";
import { structureStep } from "../steps/structure.js";
import { stackStep } from "../steps/stack.js";
import { mdnsStep } from "../steps/mdns.js";
import { backupStep } from "../steps/backup.js";
import { cliLinkStep } from "../steps/clilink.js";

export interface SetupOpts {
  config?: string;
  install?: string[];
  skipBackup?: boolean;
  noLink?: boolean;
}

export async function setupCommand(opts: SetupOpts): Promise<void> {
  requireLinux();
  requireRoot();

  let cfg = loadConfig(opts.config);

  // Optionally add catalog apps in the same pass.
  if (opts.install?.length) {
    const unknown = opts.install.filter((n) => !getApp(n));
    if (unknown.length) {
      die(`unknown app(s): ${unknown.join(", ")}. Available: ${catalogNames().join(", ")}`);
    }
    saveInstalled(cfg, [...cfg.installed, ...opts.install]);
    cfg = loadConfig(opts.config);
  }

  await resolveUser(cfg);

  log.info(`stack user=${cfg.user} (${cfg.puid}:${cfg.pgid}) root=${cfg.paths.root}`);
  log.info(`core: caddy, portainer | apps: ${cfg.installed.join(", ") || "(none)"}`);

  await systemStep(cfg);
  await storageStep(cfg);
  await dockerStep(cfg);
  await structureStep(cfg);
  await stackStep(cfg);
  await mdnsStep(cfg, opts.config ?? "home-stack.config.json");
  if (!opts.skipBackup) {
    await backupStep(cfg, opts.config ?? "home-stack.config.json");
  }
  if (!opts.noLink) {
    cliLinkStep();
  }

  log.step("Done");
  log.ok("setup converged. Reach services at:");
  const scheme = cfg.network.tls === "internal" ? "https" : "http";
  for (const svc of cfg.activeServices) {
    log.ok(`  ${scheme}://${svc.name}.${cfg.network.domainSuffix}`);
  }
  if (!opts.noLink) log.ok("global CLI ready: try `hstack list`");
  log.info("add more apps with: sudo hstack install <name>  (see: hstack list)");
}
