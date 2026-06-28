import type { AppContext, ComposeService } from "./types.js";

/** In-container mount point for the stack-wide shared directory (same in every service). */
export const SHARED_CONTAINER_PATH = "/shared";

/** Host shared root → `/shared` inside every container. */
export function sharedVolumeMount(ctx: AppContext): string {
  return `${ctx.paths.shared}:${SHARED_CONTAINER_PATH}`;
}

type VolumeEntry = string | Record<string, unknown>;

/** Normalize array- or dictionary-form compose volumes into a single list. */
function toVolumeList(volumes: unknown): VolumeEntry[] {
  if (Array.isArray(volumes)) return [...(volumes as VolumeEntry[])];
  if (volumes !== null && typeof volumes === "object") {
    return Object.values(volumes as Record<string, VolumeEntry>);
  }
  return [];
}

type BindMount = { host: string; container: string; mode?: "ro" | "rw" };

/** Parse docker-compose short-syntax bind mount (supports optional `:ro` / `:rw`). */
function parseBindMount(volume: string): BindMount | null {
  const parts = volume.split(":");
  if (parts.length < 2) return null;

  let mode: BindMount["mode"];
  const last = parts[parts.length - 1];
  if (last === "ro" || last === "rw") {
    mode = last;
    parts.pop();
  }
  if (parts.length < 2) return null;

  const container = parts.pop()!;
  const host = parts.join(":");
  return { host, container, mode };
}

function bindMountMatchesShared(volume: string, hostRoot: string): boolean {
  const parsed = parseBindMount(volume);
  return parsed?.host === hostRoot && parsed?.container === SHARED_CONTAINER_PATH;
}

function hasSharedMount(volumes: VolumeEntry[], mount: string, hostRoot: string): boolean {
  return volumes.some((v) => {
    if (typeof v === "string") {
      return v === mount || bindMountMatchesShared(v, hostRoot);
    }
    if (v && typeof v === "object") {
      return v.target === SHARED_CONTAINER_PATH && v.source === hostRoot;
    }
    return false;
  });
}

/** Append the stack-wide shared volume to a compose service (idempotent). */
export function withSharedVolume(svc: ComposeService, ctx: AppContext): ComposeService {
  const mount = sharedVolumeMount(ctx);
  const hostRoot = ctx.paths.shared;
  const vols = toVolumeList(svc.volumes);
  if (!hasSharedMount(vols, mount, hostRoot)) vols.push(mount);
  return { ...svc, volumes: vols };
}

/** Standard TZ + PUID/PGID env for images that honour LinuxServer-style vars. */
export function idEnv(ctx: AppContext): Record<string, string> {
  return { TZ: ctx.timezone, PUID: String(ctx.puid), PGID: String(ctx.pgid) };
}
