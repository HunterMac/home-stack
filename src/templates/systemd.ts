/**
 * systemd unit generators. Units shell out to this very CLI (via the repo's
 * `tsx` runner) so there is a single source of truth for backup + mDNS logic.
 */
import type { ResolvedConfig } from "../config.js";

export interface UnitContext {
  /** Absolute path to the cloned repo (working dir for the CLI). */
  repoDir: string;
  /** Command that runs the CLI, e.g. "/usr/bin/npx tsx src/cli.ts". */
  cliExec: string;
  /** Stack owner. */
  user: string;
  configPath: string;
}

export function renderBackupService(ctx: UnitContext): string {
  return `[Unit]
Description=home-stack Restic backup
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${ctx.repoDir}
ExecStart=${ctx.cliExec} backup --config ${ctx.configPath}
Nice=10
IOSchedulingClass=idle
`;
}

export function renderBackupTimer(cfg: ResolvedConfig): string {
  return `[Unit]
Description=home-stack nightly Restic backup

[Timer]
OnCalendar=${cfg.backup.schedule}
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
`;
}

export function renderMdnsService(ctx: UnitContext): string {
  return `[Unit]
Description=home-stack mDNS service hostname publisher
After=avahi-daemon.service network-online.target
Wants=network-online.target
Requires=avahi-daemon.service

[Service]
Type=simple
WorkingDirectory=${ctx.repoDir}
ExecStart=${ctx.cliExec} mdns --config ${ctx.configPath}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
}
