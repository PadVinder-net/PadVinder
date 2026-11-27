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

test("no address or phone number in a query string or a path reaches Sentry", async () => {
  const before = fake!.bodies().length;
  const api = await startMain(fake!.dsn);
  const version = await fetch(`${api.url}/api/version?email=noor%40example.test&phone=0612345678`);
  expect(version.status).toBe(200);
  // Validation answers before the login is checked: a traced 400 with the address in its path.
  const invalid = await fetch(
    `${api.url}/api/membership-requests/noor%40example.test?phone=0612345678`,
  );
  expect(invalid.status).toBe(400);
  api.child.kill("SIGTERM");
  expect(await api.closed).toBe(0);

  const names = fake!.transactions().map((transaction) => transaction.transaction);
  expect(names, api.output()).toContain("GET /api/version");
  expect(names).toContain("GET /api/membership-requests/:id");
  const sent = fake!.bodies().slice(before).join("\n");
  expect(sent).not.toContain("example.test");
  expect(sent).not.toContain("0612345678");
}, 30_000);

test("an API that cannot start sends its error to Sentry before it exits", async () => {
  const before = fake!.events().length;
  // Occupy the port, so listen fails after the database and the hub have started.
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const { port } = blocker.address() as { port: number };
  try {
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
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1",
        MAIL_FROM: "PadVinder <noreply@padvinder.test>",
        SENTRY_DSN: fake!.dsn,
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code, output).toBe(1);
    const events = fake!.events().slice(before);
    expect(events, output).toHaveLength(1);
    expect(JSON.stringify(events[0])).toContain("API failed to start");
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
}, 30_000);

test("an event Sentry refuses is logged with Sentry's status", async () => {
  const refusing = await startFakeSentry();
  refusing.answerWith(403);
  try {
    const api = await startMain(refusing.dsn);
    // A traced request: its transaction is refused at shutdown, when the SDK flushes.
    const res = await fetch(`${api.url}/api/auth/email-otp/send-verification-otp`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email: "refused@example.test", type: "sign-in" }),
    });
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 500));
    api.child.kill("SIGTERM");
    expect(await api.closed).toBe(0);
    const line = api
      .output()
      .split("\n")
      .find((text) => text.includes("Sentry did not take an event"));
    expect(line, api.output()).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ level: "warn", sentryStatus: 403 });
  } finally {
    await refusing.close();
  }
}, 30_000);
