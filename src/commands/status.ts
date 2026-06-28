/** `status` command: quick health overview of the stack. */
import { loadConfig, serviceFqdn } from "../config.js";
import { capture } from "../util/exec.js";
import { log } from "../util/log.js";
import { resticSnapshots } from "../util/restic.js";

export async function statusCommand(opts: { config?: string }): Promise<void> {
  const cfg = loadConfig(opts.config);

  log.step("Containers");
  const ps = await capture(
    "docker",
    [
      "compose",
      "--project-name",
      "home-stack",
      "--project-directory",
      cfg.paths.compose,
      "-f",
      `${cfg.paths.compose}/docker-compose.yml`,
      "ps",
    ],
    { allowFail: true },
  );
  process.stdout.write((ps || "(stack not deployed yet)") + "\n");

  log.step("Service URLs");
  const scheme = cfg.network.tls === "internal" ? "https" : "http";
  for (const svc of cfg.activeServices) {
    log.ok(`${scheme}://${serviceFqdn(svc, cfg)}  ->  ${svc.upstreamHost ?? svc.name}:${svc.upstreamPort}`);
  }

  log.step("Backup snapshots");
  const snaps = await resticSnapshots(cfg);
  process.stdout.write((snaps || "(no restic repo / no snapshots)") + "\n");
}
