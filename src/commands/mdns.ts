/**
 * `mdns` command: long-running mDNS publisher invoked by the systemd service.
 *
 * Avahi already advertises `<hostname>.local`. Here we publish an address (A)
 * record for every `<service>.local` pointing at this host's primary IPv4, by
 * supervising one `avahi-publish -a` process per service. On SIGTERM/SIGINT we
 * tear them all down so systemd restarts cleanly.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { loadConfig, serviceFqdn } from "../config.js";
import { capture } from "../util/exec.js";
import { log, die } from "../util/log.js";

export async function mdnsCommand(opts: { config?: string }): Promise<void> {
  const cfg = loadConfig(opts.config);

  const ip = await primaryIpv4();
  if (!ip) die("could not determine primary IPv4 address");
  log.info(`publishing mDNS A records -> ${ip}`);

  const children: ChildProcess[] = [];
  for (const svc of cfg.activeServices) {
    const fqdn = serviceFqdn(svc, cfg);
    log.ok(`avahi-publish ${fqdn} ${ip}`);
    // -a: address record, -R: also allow reverse, keeps process in foreground.
    const child = spawn("avahi-publish", ["-a", "-R", fqdn, ip], { stdio: "inherit" });
    child.on("exit", (code) => {
      log.warn(`avahi-publish for ${fqdn} exited (${code}); systemd will restart the unit`);
      shutdown(children, 1);
    });
    children.push(child);
  }

  const stop = () => shutdown(children, 0);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  // Keep the event loop alive indefinitely.
  await new Promise<never>(() => {});
}

function shutdown(children: ChildProcess[], code: number): void {
  for (const c of children) {
    if (!c.killed) c.kill("SIGTERM");
  }
  process.exit(code);
}

async function primaryIpv4(): Promise<string> {
  // `ip route get 1.1.1.1` reveals the source IP of the default route.
  const out = await capture(
    "sh",
    ["-c", "ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i==\"src\") print $(i+1)}'"],
    { allowFail: true },
  );
  if (out) return out.split(/\s+/)[0] ?? "";
  // Fallback: first address from hostname -I.
  const hostIps = await capture("hostname", ["-I"], { allowFail: true });
  return hostIps.split(/\s+/)[0] ?? "";
}
