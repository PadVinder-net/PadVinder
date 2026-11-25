import { randomUUID } from "node:crypto";
import type { MailJob } from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { sql } from "drizzle-orm";
import { PgBoss, type QueueResult } from "pg-boss";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createMemoryMailQueue,
  createQueueMail,
  ensureMailQueue,
  MAIL_QUEUE,
  MAIL_QUEUE_OPTIONS,
} from "./queue";

let t: TestDatabase | undefined;
let boss: PgBoss;
beforeAll(async () => {
  t = await createTestDatabase();
  boss = new PgBoss(t.url);
  boss.on("error", (error) => console.error(error));
  await boss.start();
  await ensureMailQueue(boss);
});
afterAll(async () => {
  await boss?.stop({ graceful: true, timeout: 5_000 });
  await t?.drop();
});

function addedJob(): MailJob {
  return { kind: "added-to-working-group", membershipId: randomUUID(), byUserId: randomUUID() };
}

async function findJobs(job: MailJob) {
  return boss.findJobs<MailJob>(MAIL_QUEUE, { data: job });
}

test("a job queued in a transaction that commits is in the queue", async () => {
  const queueMail = createQueueMail(boss);
  const job = addedJob();
  await t!.db.transaction(async (tx) => {
    await queueMail(tx, job);
  });
  const jobs = await findJobs(job);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]!.state).toBe("created");
  // The job takes the queue's retry options.
  expect(jobs[0]).toMatchObject({
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
  });
});

test("a job queued in a transaction that rolls back is not", async () => {
  const queueMail = createQueueMail(boss);
  const job = addedJob();
  const rollback = new Error("rollback");
  await expect(
    t!.db.transaction(async (tx) => {
      await queueMail(tx, job);
      // Inside the transaction the job is there, so pg-boss really used this transaction.
      const [row] = (
        await tx.execute<{ count: number }>(
          sql`select count(*)::int as count from pgboss.job where name = ${MAIL_QUEUE} and data = ${JSON.stringify(job)}::jsonb`,
        )
      ).rows;
      expect(row!.count).toBe(1);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await findJobs(job)).toHaveLength(0);
});

test("the stored job data holds exactly the IDs and the kind", async () => {
  const queueMail = createQueueMail(boss);
  const jobs: MailJob[] = [
    addedJob(),
    { kind: "first-coordinator", membershipId: randomUUID(), byUserId: randomUUID() },
    {
      kind: "invited-to-working-group",
      userId: randomUUID(),
      workingGroupId: randomUUID(),
      byUserId: randomUUID(),
    },
    { kind: "organization-admin", userId: randomUUID(), organizationId: randomUUID() },
  ];
  await t!.db.transaction(async (tx) => {
    for (const job of jobs) await queueMail(tx, job);
  });
  for (const job of jobs) {
    const [found] = await findJobs(job);
    const { rows } = await t!.pool.query<{ data: unknown }>(
      "select data from pgboss.job where id = $1",
      [found!.id],
    );
    expect(rows[0]!.data).toStrictEqual(job);
  }
});

test("a job that is not a valid mail job is refused and nothing is queued", async () => {
  const queueMail = createQueueMail(boss);
  const job = { ...addedJob(), email: "noor@example.test" } as unknown as MailJob;
  await expect(
    t!.db.transaction(async (tx) => {
      await queueMail(tx, job);
    }),
  ).rejects.toThrow();
  const { rows } = await t!.pool.query(
    "select 1 from pgboss.job where name = $1 and data ? 'email'",
    [MAIL_QUEUE],
  );
  expect(rows).toHaveLength(0);
});

test("ensureMailQueue twice changes nothing and sets the retry options", async () => {
  await boss.deleteQueue(MAIL_QUEUE);
  // A queue an earlier release made with pg-boss's defaults is brought to the options.
  await boss.createQueue(MAIL_QUEUE);
  expect((await boss.getQueue(MAIL_QUEUE))?.retryLimit).not.toBe(5);

  await ensureMailQueue(boss);
  const first = await boss.getQueue(MAIL_QUEUE);
  expect(first).toMatchObject({
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 3600,
    deleteAfterSeconds: 86_400,
  });

  await ensureMailQueue(boss);
  const second = await boss.getQueue(MAIL_QUEUE);
  expect(queueSettings(second!)).toEqual(queueSettings(first!));
});

/** What a queue is, without its counts, which pg-boss's monitor changes on its own. */
function queueSettings(queue: QueueResult) {
  const {
    name,
    policy,
    partition,
    deadLetter,
    expireInSeconds,
    retentionSeconds,
    deleteAfterSeconds,
    retryLimit,
    retryDelay,
    retryBackoff,
    retryDelayMax,
    heartbeatSeconds,
    createdOn,
  } = queue;
  return {
    name,
    policy,
    partition,
    deadLetter,
    expireInSeconds,
    retentionSeconds,
    deleteAfterSeconds,
    retryLimit,
    retryDelay,
    retryBackoff,
    retryDelayMax,
    heartbeatSeconds,
    createdOn,
  };
}

test("ensureMailQueue takes other options, as tests with short retry delays pass", async () => {
  await ensureMailQueue(boss, { ...MAIL_QUEUE_OPTIONS, retryDelay: 1, retryDelayMax: 2 });
  expect(await boss.getQueue(MAIL_QUEUE)).toMatchObject({ retryDelay: 1, retryDelayMax: 2 });
  await ensureMailQueue(boss);
  expect(await boss.getQueue(MAIL_QUEUE)).toMatchObject({ retryDelay: 60, retryDelayMax: 3600 });
});

test("the memory queue validates the job and keeps it", async () => {
  const { queueMail, jobs } = createMemoryMailQueue();
  const job = addedJob();
  await t!.db.transaction(async (tx) => {
    await queueMail(tx, job);
  });
  expect(jobs).toEqual([job]);
  await expect(
    t!.db.transaction(async (tx) => {
      await queueMail(tx, { ...job, name: "Noor" } as unknown as MailJob);
    }),
  ).rejects.toThrow();
  expect(jobs).toEqual([job]);
});
