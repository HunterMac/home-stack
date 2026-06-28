/** Tiny colored logger. No deps; respects non-TTY by dropping colors. */
const tty = process.stdout.isTTY;
const c = (code: string, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

export const log = {
  info: (m: string) => console.log(`${c("34", "[*]")} ${m}`),
  ok: (m: string) => console.log(`${c("32", "[+]")} ${m}`),
  skip: (m: string) => console.log(`${c("2", "[=]")} ${m}`),
  warn: (m: string) => console.warn(`${c("33", "[!]")} ${m}`),
  err: (m: string) => console.error(`${c("31", "[x]")} ${m}`),
  step: (m: string) => console.log(`\n${c("34", "==>")} ${c("1", m)}`),
};

export class StepError extends Error {}
export function die(message: string): never {
  log.err(message);
  process.exit(1);
}
