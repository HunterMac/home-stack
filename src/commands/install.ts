/**
 * `install` / `uninstall` commands.
 *
 * Catalog apps:  install adds the name to `installed`, converges the stack.
 * Unknown apps:  check if a Docker image exists for that name, prompt the user
 *                to confirm, collect the upstream port, save to `customApps`,
 *                then converge exactly like a catalog app.
 */
import { loadConfig, saveInstalled, saveCustomApp, removeCustomApp, serviceFqdn, validateCustomAppName, assertCustomAppNameAllowed, type CustomApp } from "../config.js";
import { getApp, catalogNames } from "../catalog.js";
import { requireRoot, requireLinux, resolveUser } from "../util/system.js";
import { log, die } from "../util/log.js";
import { structureStep } from "../steps/structure.js";
import { stackStep } from "../steps/stack.js";
import { mdnsStep } from "../steps/mdns.js";
import { imageExists } from "../util/docker.js";
import { confirm, input } from "../util/prompt.js";

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

export async function installCommand(
  names: string[],
  opts: { config?: string },
): Promise<void> {
  requireLinux();
  requireRoot();
  if (names.length === 0) die("usage: hstack install <app> [app...]");

  let cfg = loadConfig(opts.config);

  const customNames_ = new Set(cfg.customApps.map((a) => a.name));

  // Split names into: catalog (resolved to canonical), already-custom, truly unknown.
  const catalogApps: string[] = [];
  const unknownApps: string[] = [];

  for (const n of names) {
    const app = getApp(n);
    if (app) {
      catalogApps.push(n);
    } else if (customNames_.has(n)) {
      log.skip(`${n} already installed as a custom app`);
    } else {
      unknownApps.push(n);
    }
  }

  // --- catalog apps ---
  const nextInstalled = [...cfg.installed];
  for (const n of catalogApps) {
    if (nextInstalled.includes(n)) log.skip(`${n} already installed`);
    else { nextInstalled.push(n); log.ok(`adding catalog app: ${n}`); }
  }
  if (nextInstalled.length !== cfg.installed.length) saveInstalled(cfg, nextInstalled);

  // --- unknown apps: image-check → prompt → save as custom ---
  for (const n of unknownApps) {
    await handleUnknownApp(n, opts.config);
  }

  // Reload + converge.
  cfg = loadConfig(opts.config);
  await resolveUser(cfg);
  await structureStep(cfg);
  await stackStep(cfg);
  await mdnsStep(cfg, opts.config ?? "home-stack.config.json");

  log.step("Done");
  const scheme = cfg.network.tls === "internal" ? "https" : "http";
  for (const n of [...catalogApps, ...unknownApps]) {
    const svc = cfg.activeServices.find((s) => s.name === n);
    if (!svc) continue;
    log.ok(`${scheme}://${serviceFqdn(svc, cfg)}`);
    const catApp = getApp(n);
    if (catApp?.note) log.info(`  ${catApp.note}`);
  }
}

async function handleUnknownApp(name: string, configPath: string | undefined): Promise<void> {
  validateCustomAppName(name);

  log.warn(`'${name}' is not in the catalog.`);
  log.warn(`Catalog apps: ${catalogNames().join(", ")} (see: hstack list)`);

  // 1. Normalise to a candidate image: bare name → "library/name" on Docker Hub.
  const candidate = name.includes("/") ? name : `library/${name}`;
  const found = await imageExists(candidate);

  if (!found) {
    log.warn(`no Docker Hub image found for '${name}'`);
    const custom = await confirm(`Enter a custom image reference manually?`, false);
    if (!custom) { log.warn(`skipping '${name}'`); return; }
  } else {
    log.ok(`found Docker Hub image: ${found ? candidate : name}`);
    const proceed = await confirm(`'${name}' is not a supported catalog app. Add it as a custom app?`, true);
    if (!proceed) { log.warn(`skipping '${name}'`); return; }
  }

  // 2. Collect image reference.
  const defaultImage = found ? (name.includes("/") ? name : `${name}:latest`) : "";
  const image = await input("Docker image (e.g. ollama/ollama:latest)", defaultImage);
  if (!image) { die("image reference is required"); }

  // 3. Collect upstream port.
  const portStr = await input("Container port Caddy should proxy to (e.g. 11434)");
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port <= 0 || port > 65535) die(`invalid port: ${portStr}`);

  // 4. Persist (validated before write so config stays loadable).
  const cfg = loadConfig(configPath);
  assertCustomAppNameAllowed(name, cfg);
  const customApp: CustomApp = { name, image, port };
  saveCustomApp(cfg, customApp);
  log.ok(`saved custom app '${name}' (${image}:${port}) to config`);
  log.warn("Custom app uses a generic template (appdata/<name>:/data, config/<name>:/config).");
  log.warn(`Review docker logs for '${name}' after install; adjust volumes/env in config if needed.`);
}

// ---------------------------------------------------------------------------
// uninstall
// ---------------------------------------------------------------------------

export async function uninstallCommand(
  names: string[],
  opts: { config?: string; purge?: boolean },
): Promise<void> {
  requireLinux();
  requireRoot();
  if (names.length === 0) die("usage: hstack uninstall <app> [app...]");

  let cfg = loadConfig(opts.config);

  const nextInstalled = cfg.installed.filter((n) => !names.includes(n));
  for (const n of names) {
    if (cfg.installed.includes(n)) { log.ok(`removing catalog app: ${n}`); }
    else if (cfg.customApps.some((a) => a.name === n)) {
      removeCustomApp(cfg, n);
      log.ok(`removing custom app: ${n}`);
    } else {
      log.skip(`${n} not installed`);
    }
  }
  saveInstalled(cfg, nextInstalled);

  cfg = loadConfig(opts.config);
  await resolveUser(cfg);
  await stackStep(cfg);
  await mdnsStep(cfg, opts.config ?? "home-stack.config.json");

  log.step("Uninstalled");
  log.info(`persistent data kept under ${cfg.paths.appdata}/<app> and ${cfg.paths.config}/<app>`);
  if (opts.purge) log.warn("--purge: delete those folders manually to remove data");
}
