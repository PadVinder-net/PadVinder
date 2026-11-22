import { drizzle, type NodePgDatabase, type NodePgTransaction } from "drizzle-orm/node-postgres";
import pg from "pg";
import { relations } from "./relations";

export type Db = NodePgDatabase<typeof relations>;
/** The `tx` that `db.transaction(async (tx) => ...)` passes. */
export type DbTransaction = NodePgTransaction<typeof relations>;

export type CreateDbOptions = {
  /** Called when an idle client fails, for example after a database restart. Defaults to logging. */
  onError?: (error: Error) => void;
  /** Per-statement timeout in milliseconds; 0 disables it. Defaults to 5 seconds. */
  statementTimeoutMs?: number;
};

/** How much longer the client waits than the server-side statement timeout. */
const QUERY_TIMEOUT_MARGIN_MS = 1_000;

/** Pools connect lazily, so an unreachable server only fails on the first query. */
export function createDb(
  databaseUrl: string,
  options: CreateDbOptions = {},
): { db: Db; pool: pg.Pool } {
  const statementTimeoutMs = options.statementTimeoutMs ?? 5_000;
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2_000,
    statement_timeout: statementTimeoutMs,
    // The statement timeout only helps while the server answers. A hung server or a half-open
    // connection never does, so the client gives up shortly after. None for the migrator (0).
    ...(statementTimeoutMs > 0 && { query_timeout: statementTimeoutMs + QUERY_TIMEOUT_MARGIN_MS }),
    // Notices a dead peer on an idle connection. Without a delay, the OS default is about 2 hours.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    application_name: "padvinder",
  });
  // Without a listener, an error on an idle client crashes the process.
  pool.on("error", options.onError ?? ((error) => console.error("Database pool error:", error)));
  // Keep Drizzle's paramsInErrors off: query parameters can hold personal data and errors are logged.
  const db = drizzle({ client: pool, relations });
  return { db, pool };
}
