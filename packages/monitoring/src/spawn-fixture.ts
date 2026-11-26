import { spawn } from "node:child_process";

/** Runs a fixture of this package with tsx, with only PATH and `env` in its environment. */
export async function spawnFixture(fixture: string, env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", fixture], {
    cwd: `${import.meta.dirname}/..`,
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, stdout, stderr };
}
