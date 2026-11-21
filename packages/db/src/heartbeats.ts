import { desc, lt } from "drizzle-orm";
import type { Db } from "./client";
import { liveEventsChannel, notify } from "./notifications";
import { workerHeartbeats } from "./schema";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function recordHeartbeat(db: Db, beatAt: Date = new Date()): Promise<Date> {
  await db.transaction(async (tx) => {
    await tx.insert(workerHeartbeats).values({ beatAt }).onConflictDoNothing();
    await tx
      .delete(workerHeartbeats)
      .where(lt(workerHeartbeats.beatAt, new Date(Date.now() - RETENTION_MS)));
    await notify(tx, liveEventsChannel, { type: "worker-heartbeat", beatAt: beatAt.toISOString() });
  });
  return beatAt;
}

export async function getLatestHeartbeat(db: Db): Promise<Date | null> {
  const [row] = await db
    .select({ beatAt: workerHeartbeats.beatAt })
    .from(workerHeartbeats)
    .orderBy(desc(workerHeartbeats.beatAt))
    .limit(1);
  return row?.beatAt ?? null;
}
