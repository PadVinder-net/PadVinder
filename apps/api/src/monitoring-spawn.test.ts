import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { startFakeSentry } from "@padvinder/monitoring/testing";
import { afterAll, beforeAll, expect, test } from "vitest";

const ORIGIN = "http://localhost:4100";

let t: TestDatabase | undefined;
let fake: Awaited<ReturnType<typeof startFakeSentry>> | undefined;

beforeAll(async () => {
  t = await createTestDatabase();
  fake = await startFakeSentry();
});
afterAll(async () => {
  await fake?.close();
  await t?.drop();
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Starts main.ts the way `tsx` runs it in development and waits for "API started". */
async function startMain(sentryDsn: string) {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: `${import.meta.dirname}/..`,
    env: {
      PATH: process.env.PATH ?? "",
      DATABASE_URL: t!.url,
      API_PORT: String(port),
      API_HOST: "127.0.0.1",
      ALLOWED_ORIGINS: ORIGIN,
      AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
      PUBLIC_ORIGIN: ORIGIN,
      // Nothing listens there: the login code mail fails in the background.
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1",
      MAIL_FROM: "PadVinder <noreply@padvinder.test>",
      SENTRY_DSN: sentryDsn,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const closed = new Promise<number | null>((resolve) => child.on("close", resolve));
  await new Promise<void>((resolve, reject) => {
    child.on("close", () => reject(new Error(`exited before it was ready: ${stdout}${stderr}`)));
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("API started")) resolve();
    });
  });
  return { url: `http://127.0.0.1:${port}`, child, closed, output: () => stdout + stderr };
}

test("a login code request is a transaction with db spans; no address reaches Sentry", async () => {
  const api = await startMain(fake!.dsn);
  const res = await fetch(`${api.url}/api/auth/email-otp/send-verification-otp`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email: "noor@example.test", type: "sign-in" }),
  });
  expect(res.status).toBe(200);
  // The failing mail is sent in the background; give it a moment so its spans and log line are
  // part of what is sent at shutdown.
  await new Promise((resolve) => setTimeout(resolve, 500));
  api.child.kill("SIGTERM");
  expect(await api.closed).toBe(0);

  const transaction = fake!
    .transactions()
    .find((tx) => tx.transaction === "POST /api/auth/email-otp/send-verification-otp");
  expect(transaction, api.output()).toBeDefined();
  expect(transaction!.spans?.some((span) => span.op === "db")).toBe(true);
  expect(fake!.bodies().join("\n")).not.toContain("noor@example.test");
}, 30_000);

test("an unreachable Sentry neither slows a request nor blocks the shutdown", async () => {
  const api = await startMain(`http://public@127.0.0.1:${await freePort()}/1`);
  const started = performance.now();
  const res = await fetch(`${api.url}/api/version`);
  expect(res.status).toBe(200);
  expect(performance.now() - started).toBeLessThan(1_000);

  const stopping = performance.now();
  api.child.kill("SIGTERM");
  expect(await api.closed).toBe(0);
  expect(performance.now() - stopping).toBeLessThan(5_000);
}, 30_000);
