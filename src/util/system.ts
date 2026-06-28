/** Root/user guards and apt helpers shared across setup steps. */
import { execa } from "execa";
import { capture, run } from "./exec.js";
import { log, die } from "./log.js";
import type { ResolvedConfig } from "../config.js";

export function requireRoot(): void {
  if (process.getuid?.() !== 0) {
    die("must run as root (use: sudo) for setup");
  }
}

export function requireLinux(): void {
  if (process.platform !== "linux") {
    die(`this configurator targets Raspberry Pi OS (linux); got ${process.platform}`);
  }
}

/** Resolve the unprivileged stack owner + uid/gid, mutating cfg in place. */
export async function resolveUser(cfg: ResolvedConfig): Promise<void> {
  let user = cfg.user || process.env.SUDO_USER || "";
  if (!user || user === "root") {
    // First regular login user (uid 1000..65533).
    user = await capture(
      "sh",
      ["-c", "awk -F: '$3>=1000 && $3<65534 {print $1; exit}' /etc/passwd"],
      { allowFail: true },
    );
  }
  if (!user) die("could not determine stack user; set `user` in home-stack.config.json");
  if (!(await commandOk("id", [user]))) die(`user '${user}' does not exist`);

  cfg.user = user;
  if (cfg.puid === null) cfg.puid = Number(await capture("id", ["-u", user]));
  if (cfg.pgid === null) cfg.pgid = Number(await capture("id", ["-g", user]));
}

/** Install only the apt packages that are missing. */
export async function aptInstall(pkgs: string[]): Promise<void> {
  const missing: string[] = [];
  for (const p of pkgs) {
    if (!(await commandOk("dpkg", ["-s", p]))) missing.push(p);
  }
  if (missing.length === 0) {
    log.skip(`apt: already installed: ${pkgs.join(" ")}`);
    return;
  }
  log.info(`apt: installing ${missing.join(" ")}`);
  await run("apt-get", ["install", "-y", ...missing], {
    env: { DEBIAN_FRONTEND: "noninteractive" },
  });
}

/** apt-get update, but at most once per day. */
export async function aptUpdateDaily(): Promise<void> {
  const stamp = "/var/lib/apt/periodic/update-success-stamp";
  const age = await capture(
    "sh",
    ["-c", `echo $(( $(date +%s) - $(stat -c %Y ${stamp} 2>/dev/null || echo 0) ))`],
    { allowFail: true },
  );
  if (age && Number(age) < 86400) {
    log.skip("apt index fresh (<24h)");
    return;
  }
  await run("apt-get", ["update", "-y"]);
}

async function commandOk(file: string, args: string[]): Promise<boolean> {
  try {
    await execa(file, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
