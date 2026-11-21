import { createDb, recordHeartbeat } from "@padvinder/db";
import { PgBoss } from "pg-boss";
import type { WorkerEnv } from "./env";
import { registerHeartbeatJob } from "./jobs/heartbeat";
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

  let bossStarted = false;
  const stop = async () => {
    if (bossStarted) await boss.stop({ graceful: true, timeout: 10_000 });
    await pool.end();
  };

  try {
    await boss.start();
    bossStarted = true;
    await registerHeartbeatJob(boss, db, logger);
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
