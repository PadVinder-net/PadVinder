import { recordHeartbeat, type Db } from "@padvinder/db";
import type { PgBoss } from "pg-boss";
import type { Logger } from "../logger";

export const HEARTBEAT_QUEUE = "heartbeat";

/**
 * A beat is only worth keeping for a short while: the beats themselves live in `worker_heartbeats`.
 * pg-boss would keep completed jobs for 7 days (about 10,000 rows); one hour keeps the job table small.
 */
export const HEARTBEAT_QUEUE_OPTIONS = { deleteAfterSeconds: 60 * 60 };

/** Records a beat every minute. Safe to call on every start: the queue and schedule are upserted. */
export async function registerHeartbeatJob(boss: PgBoss, db: Db, logger: Logger): Promise<void> {
  // createQueue ignores its options for a queue that exists (there is no upsert in pg-boss), so
  // updateQueue applies them to a queue made by an earlier release.
  await boss.createQueue(HEARTBEAT_QUEUE, HEARTBEAT_QUEUE_OPTIONS);
  await boss.updateQueue(HEARTBEAT_QUEUE, HEARTBEAT_QUEUE_OPTIONS);
  // Day boundaries and schedules use Europe/Amsterdam, never the server's time zone.
  await boss.schedule(HEARTBEAT_QUEUE, "* * * * *", null, { tz: "Europe/Amsterdam" });
  await boss.work(HEARTBEAT_QUEUE, async () => {
    try {
      await recordHeartbeat(db);
    } catch (error) {
      // pg-boss does not route handler errors to boss.on("error"). Rethrow so the job is retried.
      logger.error("Heartbeat job failed", error);
      throw error;
    }
  });
}
