import { randomUUID } from "node:crypto";
import type { MailJob } from "@padvinder/db";
import { createTestDatabase, startStallingProxy, type TestDatabase } from "@padvinder/db/testing";
import { MAIL_QUEUE } from "@padvinder/mail";
import { sql } from "drizzle-orm";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { afterEach, beforeEach, expect, test } from "vitest";
import { startMailQueue } from "./mail-queue";

const job: MailJob = {
  kind: "organization-admin",
  userId: randomUUID(),
  organizationId: randomUUID(),
};

// A fresh database per test, without pg-boss's schema: as after a fresh install, before the worker.
let t: TestDatabase | undefined;
const stops: (() => Promise<void>)[] = [];
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
  await t?.drop();
});

function queueFor(url: string) {
  const queue = startMailQueue({ DATABASE_URL: url }, { onError: (error) => console.error(error) });
  stops.push(() => queue.stop());
  return queue;
}

async function hasBossSchema(): Promise<boolean> {
  const {
    rows: [row],
  } = await t!.db.execute<{ exists: boolean }>(
    sql`select exists (select 1 from pg_namespace where nspname = 'pgboss') as "exists"`,
  );
  return row!.exists;
}

/** A started instance like the worker's, to read what was queued. */
async function reader(): Promise<PgBoss> {
  const boss = new PgBoss(t!.url);
  boss.on("error", (error) => console.error(error));
  await boss.start();
  stops.push(() => boss.stop({ graceful: false }));
  return boss;
}

test("the API's queue starts on first use and a job sent through it reaches the worker's handler", async () => {
  const queue = queueFor(t!.url);
  // Starting it touches nothing: not even pg-boss's schema exists.
  expect(await hasBossSchema()).toBe(false);

  await t!.db.transaction((tx) => queue.queueMail(tx, job));
  expect(await hasBossSchema()).toBe(true);

  const boss = await reader();
  const received = new Promise<unknown>((resolve) => {
    void boss.work(MAIL_QUEUE, { pollingIntervalSeconds: 0.5 }, async ([found]) => {
      resolve(found?.data);
    });
  });
  expect(await received).toEqual(job);
});

test("a job queued in a transaction that rolls back is gone with it", async () => {
  const queue = queueFor(t!.url);
  await expect(
    t!.db.transaction(async (tx) => {
      await queue.queueMail(tx, job);
      throw new Error("rolled back");
    }),
  ).rejects.toThrow("rolled back");
  const boss = await reader();
  expect(await boss.fetch(MAIL_QUEUE)).toEqual([]);
});

test("a job that is not a mail job is refused", async () => {
  const queue = queueFor(t!.url);
  await expect(
    t!.db.transaction((tx) =>
      queue.queueMail(tx, { ...job, email: "jan@example.test" } as unknown as MailJob),
    ),
  ).rejects.toThrow(/unrecognized key/i);
});

test("a first use that fails is tried again by the next", async () => {
  const name = new URL(t!.url).pathname.slice(1);
  const admin = new URL(t!.url);
  admin.pathname = "/postgres";
  const setConnections = async (allowed: boolean) => {
    const client = new pg.Client({ connectionString: admin.toString() });
    await client.connect();
    try {
      await client.query(`alter database "${name}" with allow_connections ${allowed}`);
    } finally {
      await client.end();
    }
  };
  const queue = queueFor(t!.url);
  // The test's own pool keeps the connection it already has; the queue cannot make a new one.
  await t!.db.transaction(async (tx) => {
    await setConnections(false);
    try {
      await expect(queue.queueMail(tx, job)).rejects.toThrow(/not currently accepting connections/);
    } finally {
      await setConnections(true);
    }
  });
  await t!.db.transaction((tx) => queue.queueMail(tx, job));
  const boss = await reader();
  const fetched = await boss.fetch(MAIL_QUEUE);
  expect(fetched.map((found) => found.data)).toEqual([job]);
});

test("a first use against a hung database gives up soon, and the next use works", async () => {
  const proxy = await startStallingProxy(t!.url);
  stops.push(() => proxy.close());
  const queue = queueFor(proxy.url);
  proxy.stall();
  const started = Date.now();
  await expect(t!.db.transaction((tx) => queue.queueMail(tx, job))).rejects.toThrow();
  // The connection timeout (2 s), not pg-boss's default of 10 s or a hang.
  expect(Date.now() - started).toBeLessThan(5_000);

  // The failed start was stopped, so the next one starts the same instance afresh.
  proxy.resume();
  await t!.db.transaction((tx) => queue.queueMail(tx, job));
  const boss = await reader();
  expect((await boss.fetch(MAIL_QUEUE)).map((found) => found.data)).toEqual([job]);
}, 15_000);

test("stop before any use opens nothing, and a stopped queue refuses", async () => {
  const queue = startMailQueue({ DATABASE_URL: "postgres://padvinder:padvinder@127.0.0.1:1/none" });
  await queue.stop();
  await expect(t!.db.transaction((tx) => queue.queueMail(tx, job))).rejects.toThrow(/stopped/);
});
