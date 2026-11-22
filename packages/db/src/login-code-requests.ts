import { and, count, eq, gte, lt } from "drizzle-orm";
import type { Db } from "./client";
import { loginCodeRequests } from "./schema";

const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Records one login code request and deletes the rows older than 24 hours. */
export async function recordLoginCodeRequest(db: Db, email: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(loginCodeRequests).values({ email, requestedAt: now });
    await tx
      .delete(loginCodeRequests)
      .where(lt(loginCodeRequests.requestedAt, new Date(now.getTime() - RETENTION_MS)));
  });
}

export async function countLoginCodeRequests(db: Db, email: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(loginCodeRequests)
    .where(and(eq(loginCodeRequests.email, email), gte(loginCodeRequests.requestedAt, since)));
  return row?.n ?? 0;
}
