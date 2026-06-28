/** Restic environment + high-level backup/forget/restore helpers. */
import { run } from "./exec.js";
import { log } from "./log.js";
import type { ResolvedConfig } from "../config.js";

/** Env restic needs: repo location + password file. */
export function resticEnv(cfg: ResolvedConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RESTIC_REPOSITORY: cfg.backup.repo,
    RESTIC_PASSWORD_FILE: cfg.backup.passwordFile,
  };
}

/** Run a full backup then apply the retention/prune policy. */
export async function resticBackup(cfg: ResolvedConfig): Promise<void> {
  const env = resticEnv(cfg);
  const paths = cfg.backup.paths.filter(Boolean);
  if (paths.length === 0) {
    log.warn("no backup paths configured; nothing to do");
    return;
  }

  log.step("Restic backup");
  await run("restic", ["backup", "--host", "home-stack", "--tag", "auto", ...paths], { env });

  log.step("Restic retention (forget + prune)");
  await run(
    "restic",
    [
      "forget",
      "--prune",
      "--keep-daily",
      String(cfg.backup.keepDaily),
      "--keep-weekly",
      String(cfg.backup.keepWeekly),
      "--keep-monthly",
      String(cfg.backup.keepMonthly),
    ],
    { env },
  );
}

export async function resticSnapshots(cfg: ResolvedConfig): Promise<string> {
  const { execa } = await import("execa");
  const res = await execa("restic", ["snapshots", "--compact"], {
    env: resticEnv(cfg),
    reject: false,
  });
  return res.stdout?.toString() ?? "";
}
