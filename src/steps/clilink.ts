/**
 * Step: expose the `hstack` CLI globally by symlinking the repo launcher into
 * /usr/local/bin. Idempotent: only (re)links when missing or pointing elsewhere.
 */
import { existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync, chmodSync } from "node:fs";
import { repoRoot } from "../util/paths.js";
import { log } from "../util/log.js";

const DEST = "/usr/local/bin/hstack";

export function cliLinkStep(): void {
  log.step("Global CLI link");

  const target = `${repoRoot()}/bin/hstack`;
  if (!existsSync(target)) {
    log.warn(`launcher not found at ${target}; skipping CLI link`);
    return;
  }
  // Make sure the launcher is executable (git may not preserve the bit).
  try {
    chmodSync(target, 0o755);
  } catch {
    /* best effort */
  }

  if (existsSync(DEST)) {
    const stat = lstatSync(DEST);
    if (stat.isDirectory()) {
      log.warn(`${DEST} is a directory — refusing to remove it. Delete it manually then re-run setup.`);
      return;
    }
    if (stat.isSymbolicLink() && readlinkSync(DEST) === target) {
      log.skip(`hstack already linked -> ${target}`);
      return;
    }
    unlinkSync(DEST);
  }

  symlinkSync(target, DEST);
  log.ok(`linked ${DEST} -> ${target}`);
}
