import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

const DEFAULT_MIGRATIONS_FOLDER = `${import.meta.dirname}/../drizzle`;

export async function runMigrations(
  databaseUrl: string,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  // Migrations such as index builds may take longer than the normal statement timeout.
  const { db, pool } = createDb(databaseUrl, { statementTimeoutMs: 0 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}
