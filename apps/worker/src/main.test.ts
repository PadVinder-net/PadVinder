import { spawn } from "node:child_process";
import { expect, test } from "vitest";

/** Runs main.ts the way `tsx` runs it in development, with only the given environment. */
async function runMain(env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: `${import.meta.dirname}/..`,
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, stderr };
}

test("exits 1 with only the message when the environment is invalid", async () => {
  const { code, stderr } = await runMain({});
  expect(code).toBe(1);
  expect(stderr).toMatch(/^Invalid worker environment: DATABASE_URL: /);
  // No stack trace: the message names every problem.
  expect(stderr).not.toMatch(/\n\s+at /);
}, 15_000);
