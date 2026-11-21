import { recordHeartbeat, type Db } from "@padvinder/db";
import type { PgBoss } from "pg-boss";
import type { Logger } from "../logger";

export const HEARTBEAT_QUEUE = "heartbeat";

/** Records a beat every minute. Safe to call on every start: the queue and schedule are upserted. */
export async function registerHeartbeatJob(boss: PgBoss, db: Db, logger: Logger): Promise<void> {
  await boss.createQueue(HEARTBEAT_QUEUE);
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
