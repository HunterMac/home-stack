#!/usr/bin/env -S npx tsx
/**
 * home-stack - idempotent Raspberry Pi 5 home-services configurator.
 *
 * Usage (run setup with sudo):
 *   sudo npm run setup -- --with-homeassistant
 *   npm run status
 *   npm run backup
 *   npm run restore -- --list
 */
import { Command } from "commander";
import { log } from "./util/log.js";
import { setupCommand } from "./commands/setup.js";
import { backupCommand } from "./commands/backup.js";
import { restoreCommand } from "./commands/restore.js";
import { statusCommand } from "./commands/status.js";
import { mdnsCommand } from "./commands/mdns.js";
import { installCommand, uninstallCommand } from "./commands/install.js";
import { listCommand } from "./commands/list.js";

const program = new Command();

program
  .name("home-stack")
  .description("Idempotent Raspberry Pi Docker home-services stack configurator")
  .option("-c, --config <path>", "path to config file", "home-stack.config.json");

program
  .command("setup")
  .description("provision/converge the whole stack (run as root)")
  .option("--install <names...>", "also install these catalog apps")
  .option("--skip-backup", "skip Restic backup configuration", false)
  .action(async (opts) => {
    await setupCommand({
      config: program.opts().config,
      install: opts.install,
      skipBackup: opts.skipBackup,
    });
  });

program
  .command("install")
  .argument("<apps...>", "catalog app name(s), e.g. jellyfin homeassistant")
  .description("install catalog app(s) and converge the stack (run as root)")
  .action(async (apps: string[]) => {
    await installCommand(apps, { config: program.opts().config });
  });

program
  .command("uninstall")
  .argument("<apps...>", "catalog app name(s) to remove")
  .description("remove app(s) and converge (data kept unless --purge) (run as root)")
  .option("--purge", "also hint removal of persistent data", false)
  .action(async (apps: string[], opts) => {
    await uninstallCommand(apps, { config: program.opts().config, purge: opts.purge });
  });

program
  .command("list")
  .description("list the app catalog + install status")
  .action(async () => {
    await listCommand({ config: program.opts().config });
  });

program
  .command("backup")
  .description("run a Restic backup + retention now")
  .action(async () => {
    await backupCommand({ config: program.opts().config });
  });

program
  .command("restore")
  .description("restore from a Restic snapshot")
  .option("--list", "list snapshots and exit", false)
  .option("--snapshot <id>", "snapshot id or 'latest'")
  .option("--target <dir>", "restore into this directory (staging)")
  .option("--in-place", "restore over the live paths (dangerous)", false)
  .action(async (opts) => {
    await restoreCommand({
      config: program.opts().config,
      list: opts.list,
      snapshot: opts.snapshot,
      target: opts.target,
      inPlace: opts.inPlace,
    });
  });

program
  .command("status")
  .description("show containers, service URLs and backup snapshots")
  .action(async () => {
    await statusCommand({ config: program.opts().config });
  });

program
  .command("mdns")
  .description("(internal) long-running mDNS publisher used by systemd")
  .action(async () => {
    await mdnsCommand({ config: program.opts().config });
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  log.err(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
