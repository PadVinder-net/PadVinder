import { spawn } from "node:child_process";
import { expect, test } from "vitest";

async function runFixture(mode: string) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/crash-fixture.ts", mode], {
    cwd: `${import.meta.dirname}/..`,
    env: { PATH: process.env.PATH ?? "" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, stdout, stderr };
}

test.each(["throw", "reject"])(
  "a crash (%s) is logged as JSON and exits 1",
  async (mode) => {
    const { code, stdout, stderr } = await runFixture(mode);
    expect(code).toBe(1);
    const line = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(line).toMatchObject({ level: "error", service: "api" });
    expect(stdout).not.toMatch(/@(b|d)\.test/);
    expect(stderr).toContain("before-exit");
  },
  15_000,
);
