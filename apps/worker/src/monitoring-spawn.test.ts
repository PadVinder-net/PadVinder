import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { createQueueMail, MAIL_QUEUE } from "@padvinder/mail";
import { startFakeSentry } from "@padvinder/monitoring/testing";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, test } from "vitest";

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

test("a mail job is a transaction with db spans, tagged with the job; the heartbeat is not traced", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: `${import.meta.dirname}/..`,
    env: {
      PATH: process.env.PATH ?? "",
      DATABASE_URL: t!.url,
      PUBLIC_ORIGIN: "http://localhost:4101",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1",
      MAIL_FROM: "PadVinder <noreply@padvinder.test>",
      SENTRY_DSN: fake!.dsn,
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
      if (stdout.includes("Worker started")) resolve();
    });
  });

  // The worker has made the queue; queue a mail about a membership that does not exist, as the
  // API would, so the worker loads it and drops it.
  const sender = new PgBoss(t!.url);
  sender.on("error", (error) => console.error(error));
  await sender.start();
  const queueMail = createQueueMail(sender);
  await t!.db.transaction(async (tx) => {
    await queueMail(tx, {
      kind: "added-to-working-group",
      membershipId: randomUUID(),
      byUserId: randomUUID(),
    });
  });
  await sender.stop({ graceful: true, timeout: 5_000 });
  expect(MAIL_QUEUE).toBe("mail");

  // The worker picks the job up within a few seconds.
  await expect
    .poll(() => fake!.transactions().some((tx) => tx.transaction === "mail"), {
      timeout: 20_000,
      message: stdout + stderr,
    })
    .toBe(true);
  child.kill("SIGTERM");
  expect(await closed).toBe(0);

  const transaction = fake!.transactions().find((tx) => tx.transaction === "mail");
  expect(transaction!.tags).toMatchObject({ "job.name": "mail", service: "worker" });
  expect(transaction!.tags?.["job.id"]).toEqual(expect.any(String));
  expect(transaction!.spans?.some((span) => span.op === "db")).toBe(true);
  expect(fake!.transactions().some((tx) => tx.transaction === "heartbeat")).toBe(false);
}, 60_000);

test("a worker that cannot start sends its error to Sentry before it exits", async () => {
  const before = fake!.events().length;
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: `${import.meta.dirname}/..`,
    env: {
      PATH: process.env.PATH ?? "",
      // The server answers, but this database does not exist: pg-boss cannot start.
      DATABASE_URL: `${t!.url}_missing`,
      PUBLIC_ORIGIN: "http://localhost:4101",
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
  expect(output).toContain("Worker failed to start");

  const events = fake!.events().slice(before);
  expect(events, output).toHaveLength(1);
  expect(JSON.stringify(events[0])).toContain("Worker failed to start");
  expect(fake!.bodies().join("\n")).not.toContain("padvinder.test");
}, 30_000);
