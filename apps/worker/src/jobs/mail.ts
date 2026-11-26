import { setTimeout as sleep } from "node:timers/promises";
import { loadMailJobData, mailJobSchema, type Db } from "@padvinder/db";
import {
  buildMailForJob,
  describeMailError,
  ensureMailQueue,
  MAIL_QUEUE,
  MAIL_QUEUE_OPTIONS,
  type Mailer,
} from "@padvinder/mail";
import { runJobInSpan, withSpan } from "@padvinder/monitoring";
import type { Logger } from "@padvinder/logging";
import type { JobWithMetadata, PgBoss } from "pg-boss";

/** At least this long between two mails, so the mail server never sees a burst. */
export const MAIL_PAUSE_MS = 2_000;

/** A failed mail job, as pg-boss keeps it: the kind and `describeMailError`, nothing more. */
class MailJobError extends Error {
  override name = "MailJobError";
  constructor(readonly failure: { kind: string; error: ReturnType<typeof describeMailError> }) {
    super(`The ${failure.kind} mail failed: ${JSON.stringify(failure.error)}`);
  }
}

/**
 * Waits until at least `ms` milliseconds have passed since `since` by `now()`. Sleeps again for
 * what is left, because a timer can fire a millisecond early by `Date.now()`.
 */
export async function waitUntilElapsed(
  since: number,
  ms: number,
  clock: { now(): number; sleep(ms: number): Promise<unknown> } = { now: Date.now, sleep },
): Promise<void> {
  for (let left = since + ms - clock.now(); left > 0; left = since + ms - clock.now()) {
    await clock.sleep(left);
  }
}

export type MailJobDeps = {
  db: Db;
  mailer: Mailer;
  publicOrigin: string;
  logger: Logger;
  /** The least time between the end of one send and the start of the next. */
  pauseMs?: number;
  /** Tests pass short retry delays. */
  queueOptions?: typeof MAIL_QUEUE_OPTIONS;
};

/**
 * Sends the queued mails, one at a time: one worker that fetches one job at a time. Safe to call
 * on every start: the queue is created or brought to its options.
 *
 * Each job holds IDs only; the address and the names are loaded now, so a mail whose receiver or
 * subject is gone is dropped. A failed send is thrown again, so pg-boss tries the job later; the
 * logs hold the kind and what the mail server said, never an address or a name.
 */
export async function registerMailJob(boss: PgBoss, deps: MailJobDeps): Promise<void> {
  const { db, mailer, publicOrigin, logger } = deps;
  const pauseMs = deps.pauseMs ?? MAIL_PAUSE_MS;
  await ensureMailQueue(boss, deps.queueOptions ?? MAIL_QUEUE_OPTIONS);

  // The pause comes before the next send rather than after this one, so a job is marked done as
  // soon as its mail is out: a worker killed during the pause never sends that mail twice.
  let lastSendAt: number | undefined;
  const waitForPause = async () => {
    if (lastSendAt !== undefined) await waitUntilElapsed(lastSendAt, pauseMs);
  };

  const handle = (job: JobWithMetadata<unknown>) =>
    runJobInSpan({ name: job.name, id: job.id }, () => handleJob(job));

  const handleJob = async (job: JobWithMetadata<unknown>) => {
    const jobLogger = logger.child({ job: { name: job.name, id: job.id } });
    const parsed = mailJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // Trying again would not make it valid. The data is not logged: it might hold anything.
      jobLogger.error("A job in the mail queue is not a valid mail job; dropped");
      return;
    }
    const { kind } = parsed.data;
    try {
      const data = await loadMailJobData(db, parsed.data);
      if (data === null) {
        jobLogger.info({ kind }, "Mail dropped: the receiver or what it is about is gone");
        return;
      }
      const mail = buildMailForJob(data, { publicOrigin });
      await waitForPause();
      try {
        await withSpan("mail.send", "mail", { "mail.kind": kind }, () => mailer.send(mail));
      } finally {
        lastSendAt = Date.now();
      }
    } catch (error) {
      // retryCount counts the tries before this one, so the last try is the one at retryLimit.
      const failure = { kind, error: describeMailError(error) };
      if (job.retryCount >= job.retryLimit) {
        jobLogger.error(failure, "Mail dropped after the last try");
      } else {
        jobLogger.warn(
          { ...failure, tryNumber: job.retryCount + 1 },
          "Mail failed; it will be tried again",
        );
      }
      // pg-boss stores what the handler throws with the job, and a mail server's message can name
      // the address. Throw only what may be logged, so pg-boss tries the job again.
      throw new MailJobError(failure);
    }
  };

  await boss.work(
    MAIL_QUEUE,
    // One worker that fetches one job at a time (pg-boss's defaults, spelled out), so mails go out
    // one at a time. includeMetadata gives the retry limit, to tell the last try.
    { batchSize: 1, localConcurrency: 1, includeMetadata: true },
    async ([job]) => {
      if (job) await handle(job);
    },
  );
}
