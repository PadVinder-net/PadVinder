import type { QueueMail } from "@padvinder/db";
import { createQueueMail, ensureMailQueue } from "@padvinder/mail";
import type pg from "pg";
import { PgBoss, type ConstructorOptions } from "pg-boss";

/**
 * Like the API's pool (`packages/db/src/client.ts`): a server that does not answer the connect is
 * given up after 2 s. Each query is given up on the client after pg-boss's own bound of 30 s
 * (its scripts `SET LOCAL lock_timeout` and `idle_in_transaction_session_timeout` to 30 s) plus
 * the same 1 s margin, so a hung server cannot hold a first use, and with it the request's
 * transaction, open without limit. No `statement_timeout`: it would cut pg-boss's schema scripts
 * while they wait for the worker's advisory lock.
 */
const CONNECTION_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 31_000;

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
 *
 * A start that fails is stopped before the next try, so the timers and the pool it opened are
 * cleared; pg-boss starts the same instance again afterwards.
 */
export function startMailQueue(
  env: { DATABASE_URL: string },
  options: { onError?: (error: unknown) => void } = {},
): MailQueue {
  // pg-boss passes its options on to its `pg.Pool`, `query_timeout` too, but does not type it.
  const bossOptions: ConstructorOptions & Pick<pg.PoolConfig, "query_timeout"> = {
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    // Only sends; a small pool of its own, apart from the API's, so a start on first use never
    // waits for a connection that the transaction calling it holds.
    max: 2,
    supervise: false,
    schedule: false,
    registerInstance: false,
  };
  const boss = new PgBoss(bossOptions);
  // An EventEmitter without an error listener throws the error, which would end the process.
  boss.on("error", (error) => options.onError?.(error));
  const send = createQueueMail(boss);

  let ready: Promise<void> | undefined;
  let stopped = false;
  const start = (): Promise<void> => {
    ready ??= (async () => {
      await boss.start();
      await ensureMailQueue(boss);
    })().catch(async (error: unknown) => {
      // A start that failed half way may have armed pg-boss's intervals and opened its pool; a
      // second start() would arm them again without clearing them. stop() clears both.
      await boss.stop({ timeout: 5_000 }).catch(() => {});
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
