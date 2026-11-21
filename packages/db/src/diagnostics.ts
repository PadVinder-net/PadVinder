import { sql } from "drizzle-orm";
import type { Db } from "./client";

export type DatabaseDiagnostics = {
  postgresVersion: string;
  postgisVersion: string | null;
  latestMigration: { name: string; createdAt: Date } | null;
};

export async function getDatabaseDiagnostics(db: Db): Promise<DatabaseDiagnostics> {
  const version = await db.execute<{ version: string }>(
    sql`select current_setting('server_version') as version`,
  );
  const extension = await db.execute<{ present: boolean }>(
    sql`select exists (select 1 from pg_extension where extname = 'postgis') as present`,
  );
  let postgisVersion: string | null = null;
  if (extension.rows[0]?.present) {
    const postgis = await db.execute<{ version: string }>(
      sql`select postgis_lib_version() as version`,
    );
    postgisVersion = postgis.rows[0]?.version ?? null;
  }
  // created_at is the migration's own timestamp in milliseconds, not the time it was applied.
  const migration = await db.execute<{ name: string; created_at: string }>(
    sql`select name, created_at from drizzle.__drizzle_migrations order by id desc limit 1`,
  );
  const latest = migration.rows[0];
  return {
    // Without the distribution suffix: "18.1", not "18.1 (Debian 18.1-1.pgdg12+2)".
    postgresVersion: version.rows[0]?.version.split(" ")[0] ?? "",
    postgisVersion,
    latestMigration: latest
      ? { name: latest.name, createdAt: new Date(Number(latest.created_at)) }
      : null,
  };
}
