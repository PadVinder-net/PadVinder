import { and, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { Db, DbTransaction } from "./client";
import { loginCodeRequests, rateLimits } from "./schema";

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

/**
 * Deletes what the login limits keep for longer than 24 hours: login code requests (they hold
 * email addresses) and Better Auth's counters per IP address (their keys hold the address). The
 * longest limit window is a day, so nothing older is needed.
 */
export async function pruneLoginData(db: Db | DbTransaction, now: Date): Promise<void> {
  const cutoff = now.getTime() - RETENTION_MS;
  await db.delete(loginCodeRequests).where(lt(loginCodeRequests.requestedAt, new Date(cutoff)));
  await db.delete(rateLimits).where(lt(rateLimits.lastRequest, cutoff));
}

/** Records one login code request. */
export async function recordLoginCodeRequest(
  db: Db | DbTransaction,
  email: string,
  now: Date,
): Promise<void> {
  await db.insert(loginCodeRequests).values({ email, requestedAt: now });
}

/**
 * The requests for one address since each of the given moments, in one query:
 * `{ quarterHour: since15MinutesAgo }` gives `{ quarterHour: n }`.
 */
export async function countLoginCodeRequests<K extends string>(
  db: Db | DbTransaction,
  email: string,
  since: Record<K, Date>,
): Promise<Record<K, number>> {
  const entries = Object.entries(since) as [K, Date][];
  if (entries.length === 0) return {} as Record<K, number>;
  const earliest = new Date(Math.min(...entries.map(([, date]) => date.getTime())));
  const columns = Object.fromEntries(
    entries.map(([key, date]) => [
      key,
      sql<number>`count(*) filter (where ${loginCodeRequests.requestedAt} >= ${date})`.mapWith(
        Number,
      ),
    ]),
  ) as Record<K, SQL.Aliased<number> | SQL<number>>;
  const [row] = await db
    .select(columns)
    .from(loginCodeRequests)
    .where(and(eq(loginCodeRequests.email, email), gte(loginCodeRequests.requestedAt, earliest)));
  return row as Record<K, number>;
}
