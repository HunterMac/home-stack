/**
 * Docker image utilities.
 * Uses `docker manifest inspect` to check image existence without pulling.
 */
import { capture } from "./exec.js";
import { log } from "./log.js";

/**
 * True if the given image tag resolves to a manifest on the registry.
 * Normalises bare names (e.g. "ollama") to "library/ollama" for Docker Hub.
 * Returns false on any network/auth error so the caller can decide what to do.
 */
export async function imageExists(image: string): Promise<boolean> {
  log.info(`checking Docker Hub for image: ${image}`);
  try {
    const { execa } = await import("execa");
    // `docker manifest inspect` exits 0 on success, non-0 if not found.
    await execa("docker", ["manifest", "inspect", image], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to discover the exposed port(s) from an image's manifest config.
 * Returns the lowest numeric exposed port, or null if it cannot be determined.
 */
export async function guessPort(image: string): Promise<number | null> {
  try {
    const json = await capture("docker", ["inspect", "--format", "{{json .Config.ExposedPorts}}", image], {
      allowFail: true,
    });
    if (!json || json === "null") return null;
    const ports = Object.keys(JSON.parse(json))
      .map((p) => parseInt(p.split("/")[0] ?? "0", 10))
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    return ports[0] ?? null;
  } catch {
    return null;
  }
}
