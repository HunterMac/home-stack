/**
 * Idempotent filesystem helpers. Every function is safe to call repeatedly and
 * reports whether it actually changed anything (for clean re-run output).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import { execa } from "execa";
import { log } from "./log.js";

export function ensureDir(path: string, mode?: number): boolean {
  if (existsSync(path)) {
    log.skip(`dir exists: ${path}`);
  } else {
    mkdirSync(path, { recursive: true, mode });
    log.ok(`created dir: ${path}`);
  }
  if (mode !== undefined) chmodSync(path, mode);
  return true;
}

/** Write file only when content differs. Returns true if it changed on disk. */
export function writeFileIdempotent(
  path: string,
  content: string,
  opts: { mode?: number } = {},
): boolean {
  ensureDirSilent(dirname(path));
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === content) {
    log.skip(`unchanged: ${path}`);
    if (opts.mode !== undefined) chmodSync(path, opts.mode);
    return false;
  }
  writeFileSync(path, content, { mode: opts.mode });
  if (opts.mode !== undefined) chmodSync(path, opts.mode);
  log.ok(`${current === null ? "wrote" : "updated"}: ${path}`);
  return true;
}

/** Append a line to a file if not already present (exact match). */
export function ensureLine(path: string, line: string): boolean {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.split("\n");
  if (lines.includes(line)) {
    log.skip(`line present in ${path}`);
    return false;
  }
  const next = existing.length && !existing.endsWith("\n") ? existing + "\n" : existing;
  writeFileSync(path, next + line + "\n");
  log.ok(`appended to ${path}: ${line}`);
  return true;
}

/** chown -R via system command (Node's chown doesn't recurse). Idempotent enough. */
export async function chownRecursive(path: string, uid: number, gid: number): Promise<void> {
  if (!existsSync(path)) return;
  await execa("chown", ["-R", `${uid}:${gid}`, path], { stdio: "ignore" });
}

function ensureDirSilent(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function isMountpoint(path: string): boolean {
  try {
    const p = statSync(path);
    const parent = statSync(dirname(path));
    return p.dev !== parent.dev;
  } catch {
    return false;
  }
}
