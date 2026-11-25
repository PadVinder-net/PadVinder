import type { QueueMail } from "@padvinder/db";
import { createQueueMail, ensureMailQueue } from "@padvinder/mail";
import { PgBoss } from "pg-boss";

export type MailQueue = {
  /** Queues a mail job on the caller's transaction; the worker sends it. */
  queueMail: QueueMail;
  /** Stops pg-boss when it was started; a later `queueMail` throws. */
  stop(): Promise<void>;
};

/**
 * The API's own pg-boss instance, only to put mail jobs in the queue: the worker sends them.
 *
 * It runs no workers, no cron schedules (`schedule: false`) and no maintenance
 * (`supervise: false`), and keeps no row in pg-boss's instance table (`registerInstance: false`).
 * It connects, starts and calls `ensureMailQueue` on the first mail, not at boot, so a database
 * that is down does not stop the API from starting. A first use that fails throws (the change
 * that queued it rolls back) and the next use tries again.
 *
 * It does migrate (pg-boss's default): after a fresh install the API may need the queue before
 * the worker ever started, and pg-boss creates or migrates its schema in one transaction under
 * an advisory lock, so the API and the worker can do it at the same moment.
 */
export function startMailQueue(
  env: { DATABASE_URL: string },
  options: { onError?: (error: unknown) => void } = {},
): MailQueue {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    // Only sends; a small pool of its own, apart from the API's, so a start on first use never
    // waits for a connection that the transaction calling it holds.
    max: 2,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
  // An EventEmitter without an error listener throws the error, which would end the process.
  boss.on("error", (error) => options.onError?.(error));
  const send = createQueueMail(boss);

  let ready: Promise<void> | undefined;
  let stopped = false;
  const start = (): Promise<void> => {
    ready ??= (async () => {
      await boss.start();
      await ensureMailQueue(boss);
    })().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };

  return {
    async queueMail(tx, job) {
      if (stopped) throw new Error("The mail queue has stopped");
      await start();
      await send(tx, job);
    },
    async stop() {
      stopped = true;
      await ready?.catch(() => {});
      // Never started: pg-boss's stop does nothing. It has no handlers to wait for.
      await boss.stop({ timeout: 5_000 });
    },
  };
}
