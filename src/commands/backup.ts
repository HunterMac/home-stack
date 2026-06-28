/** `backup` command: run a Restic backup + retention now (used by the timer). */
import { loadConfig } from "../config.js";
import { resticBackup } from "../util/restic.js";

export async function backupCommand(opts: { config?: string }): Promise<void> {
  const cfg = loadConfig(opts.config);
  await resticBackup(cfg);
}
