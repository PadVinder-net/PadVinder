import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { afterAll, beforeAll, expect, test } from "vitest";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

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
  expect(stderr).toMatch(/^Invalid API environment: DATABASE_URL: /);
  // No stack trace: the message names every problem.
  expect(stderr).not.toMatch(/\n\s+at /);
}, 15_000);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("SIGHUP shuts down cleanly with exit 0", async () => {
  // Alwaysdata restarts a service by sending SIGTERM and starting it again once it exits. SIGHUP is handled the same way.
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: `${import.meta.dirname}/..`,
    env: {
      PATH: process.env.PATH ?? "",
      DATABASE_URL: t!.url,
      API_PORT: String(await freePort()),
      API_HOST: "127.0.0.1",
      ALLOWED_ORIGINS: "http://localhost:4100",
      AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
      PUBLIC_ORIGIN: "http://localhost:4100",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1",
      MAIL_FROM: "PadVinder <noreply@padvinder.test>",
    },
  });
  let stdout = "";
  const closed = new Promise<number | null>((resolve) => child.on("close", resolve));
  await new Promise<void>((resolve, reject) => {
    child.on("close", () => reject(new Error(`exited before it was ready: ${stdout}`)));
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("API started")) resolve();
    });
  });
  expect(stdout).toMatch(
    /\{"level":"info","time":\d+,"service":"api","commit":"dev","msg":"API started"\}/,
  );
  child.kill("SIGHUP");
  expect(await closed).toBe(0);
}, 30_000);
