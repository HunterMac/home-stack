/**
 * `install` / `uninstall` commands: add or remove catalog apps, then converge
 * the stack (regenerate compose + Caddyfile + mDNS and apply with docker compose).
 */
import { loadConfig, saveInstalled, serviceFqdn } from "../config.js";
import { getApp, catalogNames } from "../catalog.js";
import { requireRoot, requireLinux, resolveUser } from "../util/system.js";
import { log, die } from "../util/log.js";
import { structureStep } from "../steps/structure.js";
import { stackStep } from "../steps/stack.js";
import { mdnsStep } from "../steps/mdns.js";

export async function installCommand(
  names: string[],
  opts: { config?: string },
): Promise<void> {
  requireLinux();
  requireRoot();
  if (names.length === 0) die("usage: home-stack install <app> [app...]");

  const unknown = names.filter((n) => !getApp(n));
  if (unknown.length) {
    die(`unknown app(s): ${unknown.join(", ")}. Available: ${catalogNames().join(", ")}`);
  }

  let cfg = loadConfig(opts.config);
  const next = [...cfg.installed];
  for (const n of names) {
    if (next.includes(n)) log.skip(`${n} already installed`);
    else {
      next.push(n);
      log.ok(`adding ${n}`);
    }
  }
  saveInstalled(cfg, next);

  // Reload so activeServices reflects the new app list, then converge.
  cfg = loadConfig(opts.config);
  await resolveUser(cfg);
  await structureStep(cfg);
  await stackStep(cfg);
  await mdnsStep(cfg, opts.config ?? "home-stack.config.json");

  log.step("Installed");
  const scheme = cfg.network.tls === "internal" ? "https" : "http";
  for (const n of names) {
    const app = getApp(n)!;
    const svc = cfg.activeServices.find((s) => s.name === app.name);
    if (svc) log.ok(`${scheme}://${serviceFqdn(svc, cfg)}`);
    if (app.note) log.info(`  ${app.note}`);
  }
}

export async function uninstallCommand(
  names: string[],
  opts: { config?: string; purge?: boolean },
): Promise<void> {
  requireLinux();
  requireRoot();
  if (names.length === 0) die("usage: home-stack uninstall <app> [app...]");

  let cfg = loadConfig(opts.config);
  const next = cfg.installed.filter((n) => !names.includes(n));
  for (const n of names) {
    if (cfg.installed.includes(n)) log.ok(`removing ${n}`);
    else log.skip(`${n} not installed`);
  }
  saveInstalled(cfg, next);

  // Reload + converge. The removed container becomes an orphan and is removed
  // by `docker compose up --remove-orphans` inside stackStep.
  cfg = loadConfig(opts.config);
  await resolveUser(cfg);
  await stackStep(cfg);
  await mdnsStep(cfg, opts.config ?? "home-stack.config.json");

  log.step("Uninstalled");
  log.info(`persistent data kept under ${cfg.paths.appdata}/<app> and ${cfg.paths.config}/<app>`);
  if (opts.purge) {
    log.warn("--purge requested: delete those folders manually to remove data");
  }
}
