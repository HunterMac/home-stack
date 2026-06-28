/**
 * `service` command group: manage how services are exposed.
 *
 *   home-stack service visibility <name> <local|public>
 *   home-stack service visibility <name>            # show current
 *   home-stack service list                          # show all + exposure
 *
 * Default is "local" (LAN only, via <name>.local, non-routable from internet).
 * "public" adds a real-domain block with Let's Encrypt TLS; actually reaching
 * it still requires you to forward 80/443 (or run a tunnel) and is risky.
 */
import { loadConfig, saveVisibility, serviceFqdn, publicFqdn, isPublic } from "../config.js";
import { catalogNames } from "../catalog/index.js";
import { requireRoot, requireLinux, resolveUser } from "../util/system.js";
import { log, die } from "../util/log.js";
import { stackStep } from "../steps/stack.js";
import { mdnsStep } from "../steps/mdns.js";

const KNOWN = (): string[] => ["portainer", ...catalogNames()];

export async function serviceVisibilityCommand(
  name: string,
  mode: string | undefined,
  opts: { config?: string },
): Promise<void> {
  const cfg = loadConfig(opts.config);

  if (!KNOWN().includes(name)) {
    die(`unknown service '${name}'. Known: ${KNOWN().join(", ")}`);
  }

  // No mode => just report current visibility.
  if (!mode) {
    const current = isPublic(cfg, name) ? "public" : "local";
    log.info(`${name}: ${current}`);
    if (current === "public") log.info(`  ${publicFqdn(cfg, name)}`);
    log.info(`  ${serviceFqdn({ name, upstreamHost: name, upstreamPort: 0 }, cfg)} (LAN)`);
    return;
  }

  if (mode !== "local" && mode !== "public") {
    die(`mode must be 'local' or 'public' (got '${mode}')`);
  }

  // Changing exposure touches Caddy config + systemd; needs root.
  requireLinux();
  requireRoot();

  if (mode === "public") {
    if (!cfg.public.baseDomain) {
      die(
        "set public.baseDomain (and public.tlsEmail) in your config before making " +
          "a service public — *.local cannot be exposed to the internet",
      );
    }
    log.warn("=".repeat(64));
    log.warn(`Making '${name}' PUBLIC at ${publicFqdn(cfg, name)}`);
    log.warn("This exposes it to the internet. You MUST also:");
    log.warn("  1. forward router ports 80 + 443 to this Pi (or use a tunnel)");
    log.warn("  2. point DNS for that hostname at your public IP");
    log.warn("  3. protect it (auth.enabled + add it to auth.apps) unless it has");
    log.warn("     its own strong login. NEVER expose Portainer without auth.");
    log.warn("=".repeat(64));
  }

  const before = isPublic(cfg, name) ? "public" : "local";
  if (before === mode) {
    log.skip(`${name} already ${mode}`);
  } else {
    saveVisibility(cfg, name, mode);
    log.ok(`${name}: ${before} -> ${mode}`);
  }

  // Converge: regenerate Caddyfile + mDNS and reload.
  const fresh = loadConfig(opts.config);
  await resolveUser(fresh);
  await stackStep(fresh);
  await mdnsStep(fresh, opts.config ?? "home-stack.config.json");

  if (mode === "public") {
    log.ok(`public:  https://${publicFqdn(fresh, name)}`);
  }
  log.ok(`local:   https://${serviceFqdn({ name, upstreamHost: name, upstreamPort: 0 }, fresh)}`);
}

export async function serviceListCommand(opts: { config?: string }): Promise<void> {
  const cfg = loadConfig(opts.config);
  log.step("Service exposure");
  for (const svc of cfg.activeServices) {
    const pub = isPublic(cfg, svc.name);
    const where = pub ? `public (${publicFqdn(cfg, svc.name)})` : "local";
    console.log(`  ${svc.name.padEnd(16)} ${where}`);
  }
  if (!cfg.public.baseDomain) {
    log.info("set public.baseDomain + public.tlsEmail to enable public exposure");
  }
}
