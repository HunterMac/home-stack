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
  const changed = writeFileIdempotent(
    unitPath,
    renderMdnsService({
      repoDir: repoRoot(),
      cliExec: cliExec(),
      user: cfg.user,
      configPath: resolve(configPath),
    }),
  );

  if (changed) await run("systemctl", ["daemon-reload"]);

  await run("systemctl", ["enable", "home-stack-mdns"]);
  if (changed) {
    // Unit content changed: restart applies it (and starts it if stopped).
    await run("systemctl", ["restart", "home-stack-mdns"]);
  } else if (await ok("systemctl", ["is-active", "--quiet", "home-stack-mdns"])) {
    log.skip("home-stack-mdns already active");
  } else {
    await run("systemctl", ["start", "home-stack-mdns"]);
  }

  const hosts = cfg.activeServices
    .map((s) => `${s.name}.${cfg.network.domainSuffix}`)
    .join(", ");
  log.ok(`publishing mDNS hosts: ${hosts}`);
}
