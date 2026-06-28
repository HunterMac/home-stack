/** Step: base OS prep - packages, timezone, mDNS daemon. */
import { run, capture, ok } from "../util/exec.js";
import { aptInstall, aptUpdateDaily } from "../util/system.js";
import { log } from "../util/log.js";
import type { ResolvedConfig } from "../config.js";

export async function systemStep(cfg: ResolvedConfig): Promise<void> {
  log.step("System base setup");

  await aptUpdateDaily();
  await aptInstall([
    "ca-certificates",
    "curl",
    "gnupg",
    "avahi-daemon",
    "avahi-utils",
    "restic",
    "jq",
    "git",
  ]);

  // Timezone.
  const current = await capture("timedatectl", ["show", "-p", "Timezone", "--value"], {
    allowFail: true,
  });
  if (current === cfg.timezone) {
    log.skip(`timezone already ${cfg.timezone}`);
  } else {
    await run("timedatectl", ["set-timezone", cfg.timezone]);
  }

  // Ensure avahi (mDNS) is enabled + running.
  if (await ok("systemctl", ["is-enabled", "--quiet", "avahi-daemon"])) {
    log.skip("avahi-daemon enabled");
  } else {
    await run("systemctl", ["enable", "--now", "avahi-daemon"]);
  }
}
