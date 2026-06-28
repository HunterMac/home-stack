/** Thin wrappers around execa for running system commands. */
import { execa, type Options, type Result } from "execa";
import { log } from "./log.js";

export interface RunOptions extends Options {
  /** Print the command before running it. */
  quiet?: boolean;
}

/** Run a command, inheriting stdio by default so installers stream output. */
export async function run(
  file: string,
  args: string[] = [],
  opts: RunOptions = {},
): Promise<Result> {
  const { quiet, ...rest } = opts;
  if (!quiet) log.info(`$ ${file} ${args.join(" ")}`.trim());
  return execa(file, args, { stdio: "inherit", ...rest });
}

/** Run capturing stdout; returns trimmed stdout (or "" on failure if allowFail). */
export async function capture(
  file: string,
  args: string[] = [],
  opts: { allowFail?: boolean; input?: string } = {},
): Promise<string> {
  try {
    const res = await execa(file, args, {
      stdio: ["pipe", "pipe", "pipe"],
      input: opts.input,
    });
    return res.stdout.toString().trim();
  } catch (e) {
    if (opts.allowFail) return "";
    throw e;
  }
}

/** True if a command exits 0. Never throws. Pass `env` etc. via opts. */
export async function ok(
  file: string,
  args: string[] = [],
  opts: Options = {},
): Promise<boolean> {
  try {
    await execa(file, args, { stdio: "ignore", ...opts });
    return true;
  } catch {
    return false;
  }
}

/** True if a binary exists on PATH. */
export async function hasBin(name: string): Promise<boolean> {
  return ok("sh", ["-c", `command -v ${name}`]);
}
