/**
 * Step: install the systemd service that advertises each `<service>.local`
 * hostname over mDNS (Avahi), so phones/laptops resolve them with no DNS setup.
 */
import { resolve } from "node:path";
import { writeFileIdempotent } from "../util/fs.js";
import { run, ok } from "../util/exec.js";
import { log } from "../util/log.js";
import { repoRoot, cliExec } from "../util/paths.js";
import { renderMdnsService } from "../templates/systemd.js";
import type { ResolvedConfig } from "../config.js";

export async function mdnsStep(cfg: ResolvedConfig, configPath: string): Promise<void> {
  log.step("mDNS service publisher");

  const unitPath = "/etc/systemd/system/home-stack-mdns.service";
  const unitChanged = writeFileIdempotent(
    unitPath,
    renderMdnsService({
      repoDir: repoRoot(),
      cliExec: cliExec(),
      user: cfg.user,
      configPath: resolve(configPath),
    }),
  );

  // The mDNS process reads the published hosts from config at *start* time, and
  // the unit text doesn't encode them. Track the host list in a state file so we
  // can detect when the advertised set changes and restart accordingly.
  const hostList = cfg.activeServices.map((s) => `${s.name}.${cfg.network.domainSuffix}`);
  const hostsChanged = writeFileIdempotent(
    `${cfg.paths.config}/.mdns-hosts`,
    hostList.join("\n") + "\n",
  );

  if (unitChanged) await run("systemctl", ["daemon-reload"]);
  await run("systemctl", ["enable", "home-stack-mdns"]);

  const active = await ok("systemctl", ["is-active", "--quiet", "home-stack-mdns"]);
  if (unitChanged || hostsChanged || !active) {
    // restart (re)reads the host list; it also starts the unit if stopped.
    await run("systemctl", ["restart", "home-stack-mdns"]);
  } else {
    log.skip("home-stack-mdns already active with current hosts");
  }

  log.ok(`publishing mDNS hosts: ${hostList.join(", ")}`);
}
