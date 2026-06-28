/**
 * Step: render config artifacts and bring the Docker stack up.
 * - docker-compose.yml + Caddyfile are regenerated from config every run.
 * - Each installed app's seed files are written once (never overwritten).
 */
import { existsSync } from "node:fs";
import { writeFileIdempotent } from "../util/fs.js";
import { run } from "../util/exec.js";
import { log } from "../util/log.js";
import { renderCompose } from "../templates/compose.js";
import { renderCaddyfile } from "../templates/caddyfile.js";
import { appContext, type ResolvedConfig } from "../config.js";
import { getApp } from "../catalog.js";

export async function stackStep(cfg: ResolvedConfig): Promise<void> {
  log.step("Deploy stack (compose + Caddy)");

  const composeFile = `${cfg.paths.compose}/docker-compose.yml`;
  writeFileIdempotent(composeFile, renderCompose(cfg));
  writeFileIdempotent(`${cfg.paths.config}/caddy/Caddyfile`, renderCaddyfile(cfg));

  // Seed each installed app's config once so user edits survive re-runs.
  const ctx = appContext(cfg);
  for (const name of cfg.installed) {
    const app = getApp(name);
    if (!app?.seed) continue;
    for (const file of app.seed(ctx)) {
      if (existsSync(file.path)) {
        log.skip(`${name}: ${file.path} exists (left untouched)`);
      } else {
        writeFileIdempotent(file.path, file.content);
      }
    }
  }

  await run("docker", [
    "compose",
    "--project-name",
    "home-stack",
    "--project-directory",
    cfg.paths.compose,
    "-f",
    composeFile,
    "up",
    "-d",
    "--remove-orphans",
  ]);
  log.ok("stack is up");
}
