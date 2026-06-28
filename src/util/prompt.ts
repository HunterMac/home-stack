/**
 * Minimal interactive prompts over stdin/stdout.
 * Used only when the user is at a terminal (TTY). If stdin is not a TTY
 * (piped / CI), all prompts return the supplied `defaultValue`.
 */
import { createInterface } from "node:readline";

/** Ask a yes/no question. Returns true for "y/yes", false otherwise. */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  if (!process.stdin.isTTY) return defaultYes;

  const answer = await ask(`${question} ${hint}: `);
  if (!answer.trim()) return defaultYes;
  return /^y(es)?$/i.test(answer.trim());
}

/** Ask for a text value. Returns `defaultValue` if the user leaves it blank. */
export async function input(question: string, defaultValue = ""): Promise<string> {
  if (!process.stdin.isTTY) return defaultValue;
  const hint = defaultValue ? ` (${defaultValue})` : "";
  const answer = await ask(`${question}${hint}: `);
  return answer.trim() || defaultValue;
}

function ask(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("error", (err) => {
      rl.close();
      reject(err);
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
