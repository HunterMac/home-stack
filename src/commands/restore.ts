/**
 * `restore` command: restore a Restic snapshot.
 *
 *   home-stack restore --list                 # show snapshots
 *   home-stack restore --snapshot latest --target /srv/docker/_restore
 *   home-stack restore --snapshot latest --in-place   # restore over live paths
 *
 * Default target is a staging dir so you never clobber live data by accident.
 */
import { loadConfig } from "../config.js";
import { resticEnv, resticSnapshots } from "../util/restic.js";
import { run } from "../util/exec.js";
import { log } from "../util/log.js";

export interface RestoreOpts {
  config?: string;
  list?: boolean;
  snapshot?: string;
  target?: string;
  inPlace?: boolean;
}

export async function restoreCommand(opts: RestoreOpts): Promise<void> {
  const cfg = loadConfig(opts.config);
  const env = resticEnv(cfg);

  if (opts.list || !opts.snapshot) {
    log.step("Restic snapshots");
    process.stdout.write(await resticSnapshots(cfg));
    if (!opts.snapshot) {
      log.info("re-run with --snapshot <id|latest> to restore");
    }
    return;
  }

  const target = opts.inPlace ? "/" : (opts.target ?? `${cfg.paths.root}/_restore`);
  if (opts.inPlace) {
    log.warn("in-place restore will overwrite live files under the backed-up paths");
  } else {
    log.info(`restoring snapshot ${opts.snapshot} into ${target}`);
  }

  // `restic restore --target /` writes files back to their absolute paths.
  await run("restic", ["restore", opts.snapshot, "--target", target], { env });
  log.ok("restore complete");
  if (!opts.inPlace) {
    log.info(`files are under ${target}; review then copy into place, or use --in-place`);
  } else {
    log.warn("restored in-place; restart the stack with: sudo npm run setup");
  }
}
