import { createDb, recordHeartbeat } from "@padvinder/db";
import { createSmtpMailer } from "@padvinder/mail";
import { PgBoss } from "pg-boss";
import type { WorkerEnv } from "./env";
import { registerHeartbeatJob } from "./jobs/heartbeat";
import { registerMailJob } from "./jobs/mail";
import type { Logger } from "./logger";

export type RunningWorker = { stop(): Promise<void> };

/**
 * Failure mode at boot: register the job before the immediate heartbeat, and treat that first
 * heartbeat as non-fatal (the cron writes the next one). Any other startup failure is logged,
 * cleaned up and rethrown; the caller exits 1 so the service supervisor restarts the worker.
 */
export async function startWorker(env: WorkerEnv, logger: Logger): Promise<RunningWorker> {
  const { db, pool } = createDb(env.DATABASE_URL, {
    onError: (error) => logger.error("Database pool error", error),
  });
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (error) => logger.error("pg-boss error", error));
  // The settings whole, so the mailer puts MAIL_SUBJECT_PREFIX before every subject, as in the API.
  const mailer = createSmtpMailer(env);

  let bossStarted = false;
  const stop = async () => {
    // A graceful stop lets a mail that is being sent finish first.
    if (bossStarted) await boss.stop({ graceful: true, timeout: 10_000 });
    mailer.close();
    await pool.end();
  };

  try {
    await boss.start();
    bossStarted = true;
    await registerHeartbeatJob(boss, db, logger);
    await registerMailJob(boss, { db, mailer, publicOrigin: env.PUBLIC_ORIGIN, logger });
  } catch (error) {
    logger.error("Worker failed to start", error);
    await stop().catch((stopError) => logger.error("Cleanup after failed start failed", stopError));
    throw error;
  }

  try {
    await recordHeartbeat(db);
  } catch (error) {
    logger.warn("Immediate heartbeat failed; the next scheduled one will record", error);
  }
  return { stop };
}
