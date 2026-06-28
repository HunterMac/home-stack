/**
 * Step: provision the storage root.
 *   Phase 1: ext4 under storage.root (optionally on a dedicated device).
 *   Phase 2: btrfs subvolumes (snapshot-friendly).
 */
import { capture, run } from "../util/exec.js";
import { aptInstall } from "../util/system.js";
import { ensureDir, ensureLine, isMountpoint } from "../util/fs.js";
import { log, die } from "../util/log.js";
import { existsSync } from "node:fs";
import type { ResolvedConfig } from "../config.js";

async function prepareDevice(dev: string, fstype: "ext4" | "btrfs", root: string): Promise<void> {
  if (!(await deviceIsBlock(dev))) die(`device '${dev}' is not a block device`);

  const existing = await capture("blkid", ["-o", "value", "-s", "TYPE", dev], { allowFail: true });
  if (existing) {
    log.info(`device ${dev} already has filesystem (${existing}); not formatting`);
  } else {
    log.warn(`formatting ${dev} as ${fstype} (no filesystem detected)`);
    if (fstype === "ext4") await run("mkfs.ext4", ["-q", dev]);
    else await run("mkfs.btrfs", ["-q", "-f", dev]);
  }

  ensureDir(root);
  const uuid = await capture("blkid", ["-o", "value", "-s", "UUID", dev]);
  ensureLine("/etc/fstab", `UUID=${uuid} ${root} ${fstype} defaults,noatime 0 2`);

  if (isMountpoint(root)) {
    log.skip(`${root} already mounted`);
  } else {
    await run("mount", [root]);
  }
}

async function deviceIsBlock(dev: string): Promise<boolean> {
  try {
    const { execa } = await import("execa");
    await execa("test", ["-b", dev]);
    return true;
  } catch {
    return false;
  }
}

export async function storageStep(cfg: ResolvedConfig): Promise<void> {
  log.step(`Storage setup (phase ${cfg.storage.phase})`);
  const { root, phase, device } = cfg.storage;

  if (phase === 1) {
    if (device) {
      await prepareDevice(device, "ext4", root);
    } else {
      ensureDir(root);
      log.skip(`using existing filesystem for ${root} (no dedicated device)`);
    }
    return;
  }

  // Phase 2: btrfs subvolumes per data class.
  if (!device) die("phase 2 requires storage.device (btrfs target)");
  await aptInstall(["btrfs-progs"]);
  await prepareDevice(device, "btrfs", root);

  for (const sv of ["appdata", "config", "backups", "compose"]) {
    const path = `${root}/${sv}`;
    if (await subvolExists(path)) {
      log.skip(`btrfs subvolume exists: ${sv}`);
    } else {
      if (existsSync(path)) await run("rmdir", [path]).catch(() => undefined);
      await run("btrfs", ["subvolume", "create", path]);
    }
  }
}

async function subvolExists(path: string): Promise<boolean> {
  const { execa } = await import("execa");
  try {
    await execa("btrfs", ["subvolume", "show", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
