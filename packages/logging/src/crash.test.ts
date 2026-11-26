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
  const started = performance.now();
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, stdout, stderr, ms: performance.now() - started };
}

function errorLines(stdout: string) {
  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line.level === "error");
}

test.each(["throw", "reject", "before-exit-throws"])(
  "a crash (%s) is logged as one scrubbed JSON line and exits 1",
  async (mode) => {
    const { code, stdout, stderr } = await runFixture(mode);
    expect(code).toBe(1);
    expect(errorLines(stdout)).toEqual([expect.objectContaining({ service: "api" })]);
    expect(stdout + stderr).not.toMatch(/@(b|d|h)\.test/);
    expect(stderr).toContain("before-exit");
  },
  15_000,
);

test("a beforeExit that never settles still exits 1 after the time limit", async () => {
  const { code, stdout, ms } = await runFixture("hang");
  expect(code).toBe(1);
  expect(ms).toBeLessThan(6_000);
  expect(errorLines(stdout)).toHaveLength(1);
}, 15_000);

test("a logger that throws still exits 1, without an unscrubbed stack", async () => {
  const { code, stdout, stderr } = await runFixture("logger-throws");
  expect(code).toBe(1);
  expect(stdout + stderr).not.toMatch(/@(b|f)\.test/);
  expect(stderr).toContain("before-exit");
}, 15_000);
