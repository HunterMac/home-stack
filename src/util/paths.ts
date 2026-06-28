/** Locate the repo root + how systemd should invoke this CLI. */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

/** Repo root = parent of src/ (this file lives at src/util/paths.ts). */
export function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..");
}

/** Absolute command systemd units use to run the CLI via the local tsx. */
export function cliExec(): string {
  const root = repoRoot();
  const tsx = resolve(root, "node_modules", ".bin", "tsx");
  const entry = resolve(root, "src", "cli.ts");
  if (!existsSync(tsx)) {
    // Fall back to npx if deps are not vendored next to the units.
    return `/usr/bin/env npx tsx ${entry}`;
  }
  return `${tsx} ${entry}`;
}
