/**
 * Basic-auth hash resolver.
 *
 * Caddy's `basic_auth` needs a bcrypt hash, but we keep only the plaintext
 * password in the (gitignored) config. We derive the bcrypt hash with
 * `caddy hash-password` (run in the caddy image) and cache it next to the
 * Caddyfile, keyed by a fingerprint of user:password, so repeated `setup`
 * runs are idempotent (no new salt -> no Caddyfile churn -> no Caddy restart).
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { capture } from "./exec.js";
import { writeFileIdempotent } from "./fs.js";
import { log, die } from "./log.js";
import type { ResolvedConfig } from "../config.js";

export interface BasicAuth {
  username: string;
  /** bcrypt hash for the Caddyfile. */
  hash: string;
}

function fingerprint(username: string, password: string): string {
  return createHash("sha256").update(`${username}:${password}`).digest("hex");
}

export async function resolveBasicAuth(cfg: ResolvedConfig): Promise<BasicAuth | null> {
  if (!cfg.auth.enabled) return null;
  if (!cfg.auth.password) die("auth.enabled but auth.password is empty");

  const dir = `${cfg.paths.config}/caddy`;
  const hashPath = `${dir}/.basicauth.hash`;
  const metaPath = `${dir}/.basicauth.meta`;
  const fp = fingerprint(cfg.auth.username, cfg.auth.password);

  // Reuse cached hash if the credentials are unchanged.
  if (existsSync(hashPath) && existsSync(metaPath)) {
    if (readFileSync(metaPath, "utf8").trim() === fp) {
      return { username: cfg.auth.username, hash: readFileSync(hashPath, "utf8").trim() };
    }
  }

  log.info("generating bcrypt hash for basic-auth (caddy hash-password)");
  const hash = await capture("docker", [
    "run",
    "--rm",
    "caddy:2-alpine",
    "caddy",
    "hash-password",
    "--plaintext",
    cfg.auth.password,
  ]);
  if (!hash.startsWith("$2")) die(`unexpected hash output from caddy: ${hash.slice(0, 16)}...`);

  writeFileIdempotent(hashPath, hash + "\n", { mode: 0o600 });
  writeFileIdempotent(metaPath, fp + "\n", { mode: 0o600 });
  return { username: cfg.auth.username, hash };
}
