/** Step: install Docker Engine + compose plugin from Docker's apt repo. */
import { existsSync } from "node:fs";
import { run, capture, ok, hasBin } from "../util/exec.js";
import { aptInstall } from "../util/system.js";
import { writeFileIdempotent } from "../util/fs.js";
import { log } from "../util/log.js";
import type { ResolvedConfig } from "../config.js";

export async function dockerStep(cfg: ResolvedConfig): Promise<void> {
  log.step("Docker Engine + Compose");

  const composeOk = await ok("docker", ["compose", "version"]);
  if ((await hasBin("docker")) && composeOk) {
    log.skip("docker + compose plugin already installed");
  } else {
    await installDocker();
  }

  // Add the stack user to the docker group (effective on next login/session).
  if (cfg.user && cfg.user !== "root") {
    const groups = await capture("id", ["-nG", cfg.user], { allowFail: true });
    if (groups.split(/\s+/).includes("docker")) {
      log.skip(`${cfg.user} already in docker group`);
    } else {
      await run("usermod", ["-aG", "docker", cfg.user]);
      log.warn(`added ${cfg.user} to docker group (re-login for it to take effect)`);
    }
  }

  if (await ok("systemctl", ["is-enabled", "--quiet", "docker"])) {
    log.skip("docker service enabled");
  } else {
    await run("systemctl", ["enable", "--now", "docker"]);
  }
}

async function installDocker(): Promise<void> {
  // Use Docker's official convenience repo via apt for Debian/RPi OS.
  const keyring = "/etc/apt/keyrings/docker.asc";
  if (!existsSync(keyring)) {
    await run("install", ["-m", "0755", "-d", "/etc/apt/keyrings"]);
    const key = await capture("curl", [
      "-fsSL",
      "https://download.docker.com/linux/debian/gpg",
    ]);
    writeFileIdempotent(keyring, key, { mode: 0o644 });
  } else {
    log.skip("docker apt key present");
  }

  const arch = await capture("dpkg", ["--print-architecture"]);
  const codename = await capture("sh", [
    "-c",
    ". /etc/os-release && echo \"${VERSION_CODENAME:-bookworm}\"",
  ]);
  const repoLine =
    `deb [arch=${arch} signed-by=${keyring}] ` +
    `https://download.docker.com/linux/debian ${codename} stable`;
  writeFileIdempotent("/etc/apt/sources.list.d/docker.list", repoLine + "\n");

  await run("apt-get", ["update", "-y"]);
  await aptInstall([
    "docker-ce",
    "docker-ce-cli",
    "containerd.io",
    "docker-buildx-plugin",
    "docker-compose-plugin",
  ]);
}
