/**
 * Step: configure Restic backups.
 * - generate a repo password on first run (stored 0600 under config/restic),
 * - init the repository if empty,
 * - install the systemd service + nightly timer (calls `home-stack backup`).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { writeFileIdempotent } from "../util/fs.js";
import { run, ok } from "../util/exec.js";
import { log } from "../util/log.js";
import { repoRoot, cliExec } from "../util/paths.js";
import { resticEnv } from "../util/restic.js";
import { renderBackupService, renderBackupTimer } from "../templates/systemd.js";
import type { ResolvedConfig } from "../config.js";

export async function backupStep(cfg: ResolvedConfig, configPath: string): Promise<void> {
  log.step("Backup (Restic)");

  // 1. Password file.
  if (existsSync(cfg.backup.passwordFile)) {
    log.skip("restic password file exists");
  } else {
    writeFileIdempotent(cfg.backup.passwordFile, randomBytes(24).toString("base64") + "\n", {
      mode: 0o600,
    });
    log.warn(`generated restic password at ${cfg.backup.passwordFile} - BACK THIS UP!`);
  }

  // 2. Init repo if needed (local repos live under backups/).
  const env = resticEnv(cfg);
  const initialized = await ok("restic", ["cat", "config"], { env });
  if (initialized) {
    log.skip("restic repository already initialized");
  } else {
    log.info(`initializing restic repo at ${cfg.backup.repo}`);
    await run("restic", ["init"], { env });
  }

  // 3. systemd service + timer.
  const ctx = {
    repoDir: repoRoot(),
    cliExec: cliExec(),
    user: cfg.user,
    configPath: resolve(configPath),
  };
  const svcChanged = writeFileIdempotent(
    "/etc/systemd/system/home-stack-backup.service",
    renderBackupService(ctx),
  );
  const timerChanged = writeFileIdempotent(
    "/etc/systemd/system/home-stack-backup.timer",
    renderBackupTimer(cfg),
  );
  if (svcChanged || timerChanged) await run("systemctl", ["daemon-reload"]);

  if (await ok("systemctl", ["is-enabled", "--quiet", "home-stack-backup.timer"])) {
    log.skip("home-stack-backup.timer enabled");
    if (timerChanged) await run("systemctl", ["restart", "home-stack-backup.timer"]);
  } else {
    await run("systemctl", ["enable", "--now", "home-stack-backup.timer"]);
  }
}
