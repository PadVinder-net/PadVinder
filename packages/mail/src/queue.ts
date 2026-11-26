import { mailJobSchema, type MailJob, type QueueMail } from "@padvinder/db";
import { sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss, type QueueOptions } from "pg-boss";

/** The pg-boss queue of the mails the worker sends. */
export const MAIL_QUEUE = "mail";

/**
 * A failed send is tried 5 more times, with pauses that roughly double from a minute or two
 * (pg-boss adds some randomness), never longer than an hour. A finished job is gone within a day.
 */
export const MAIL_QUEUE_OPTIONS = {
  retryLimit: 5,
  retryDelay: 60,
  retryBackoff: true,
  retryDelayMax: 3600,
  deleteAfterSeconds: 86_400,
} satisfies QueueOptions;

/**
 * Creates the mail queue with the options, and brings a queue that exists to them. Safe on every
 * start. Tests pass short retry delays.
 */
export async function ensureMailQueue(
  boss: PgBoss,
  options: QueueOptions = MAIL_QUEUE_OPTIONS,
): Promise<void> {
  // createQueue ignores its options for a queue that exists (there is no upsert in pg-boss), so
  // updateQueue applies them to a queue made earlier.
  await boss.createQueue(MAIL_QUEUE, options);
  await boss.updateQueue(MAIL_QUEUE, options);
}

/**
 * Queues a mail job on the caller's transaction, so the job row is committed or rolled back with
 * the change. The job is validated first: it holds the kind and IDs only.
 *
 * pg-boss looks the queue up through its own connection before it inserts on the transaction,
 * so `boss` must be started.
 */
export function createQueueMail(boss: PgBoss): QueueMail {
  return async (tx, job) => {
    const data = mailJobSchema.parse(job);
    await boss.send(MAIL_QUEUE, data, { db: fromDrizzle(tx, sql) });
  };
}

/** For tests of the API: validates each job and keeps it, in the order it was queued. */
export function createMemoryMailQueue(): { queueMail: QueueMail; jobs: MailJob[] } {
  const jobs: MailJob[] = [];
  return {
    jobs,
    async queueMail(_tx, job) {
      jobs.push(mailJobSchema.parse(job));
    },
  };
}
