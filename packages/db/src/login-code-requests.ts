import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "./client";
import { loginCodeRequests } from "./schema";

const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

// The first key of the two-key advisory lock: a fixed number for "login code requests", so these
// locks cannot meet other advisory locks (pg-boss uses the one-key space).
const LOCK_CLASS = 7_310_001;

/**
 * Holds a lock for one address until the transaction ends, so a count and the record that follows
 * it cannot interleave with another request for the same address. Other addresses do not wait.
 */
export async function lockLoginCodeRequests(tx: DbTransaction, email: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_CLASS}, hashtext(${email}))`);
}

/** Deletes the rows older than 24 hours: they hold email addresses and are no longer needed. */
export async function pruneLoginCodeRequests(db: Db | DbTransaction, now: Date): Promise<void> {
  await db
    .delete(loginCodeRequests)
    .where(lt(loginCodeRequests.requestedAt, new Date(now.getTime() - RETENTION_MS)));
}

/** Records one login code request and deletes the rows older than 24 hours. */
export async function recordLoginCodeRequest(
  db: Db | DbTransaction,
  email: string,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(loginCodeRequests).values({ email, requestedAt: now });
    await pruneLoginCodeRequests(tx, now);
  });
}

export async function countLoginCodeRequests(
  db: Db | DbTransaction,
  email: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(loginCodeRequests)
    .where(and(eq(loginCodeRequests.email, email), gte(loginCodeRequests.requestedAt, since)));
  return row?.n ?? 0;
}
