/**
 * Step: render config artifacts and bring the Docker stack up.
 * - docker-compose.yml + Caddyfile are regenerated from config every run.
 * - Each installed app's seed files are written once (never overwritten).
 */
import { existsSync } from "node:fs";
import { writeFileIdempotent } from "../util/fs.js";
import { run, ok } from "../util/exec.js";
import { log } from "../util/log.js";
import { renderCompose } from "../templates/compose.js";
import { renderCaddyfile } from "../templates/caddyfile.js";
import { resolveBasicAuth } from "../util/auth.js";
import { appContext, type ResolvedConfig } from "../config.js";
import { getApp } from "../catalog.js";

export async function stackStep(cfg: ResolvedConfig): Promise<void> {
  log.step("Deploy stack (compose + Caddy)");

  const composeFile = `${cfg.paths.compose}/docker-compose.yml`;
  writeFileIdempotent(composeFile, renderCompose(cfg));

  const auth = await resolveBasicAuth(cfg);
  const caddyfileChanged = writeFileIdempotent(
    `${cfg.paths.config}/caddy/Caddyfile`,
    renderCaddyfile(cfg, auth),
  );

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

  // A changed Caddyfile needs a graceful reload (the bind-mount alone won't
  // restart Caddy). Fall back to a container restart if reload fails.
  if (caddyfileChanged && (await ok("docker", ["inspect", "caddy"]))) {
    const reloaded = await ok("docker", [
      "exec",
      "caddy",
      "caddy",
      "reload",
      "--config",
      "/etc/caddy/Caddyfile",
    ]);
    if (reloaded) log.ok("caddy reloaded");
    else await run("docker", ["restart", "caddy"]);
  }
}
