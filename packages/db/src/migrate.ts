import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

const DEFAULT_MIGRATIONS_FOLDER = `${import.meta.dirname}/../drizzle`;

/** Whether the folder holds at least one migration in Drizzle's `<name>/migration.sql` layout. */
async function hasMigrations(folder: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = await readdir(join(folder, entry.name));
    if (files.includes("migration.sql")) return true;
  }
  return false;
}

export async function runMigrations(
  databaseUrl: string,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  // Drizzle silently does nothing with a wrong folder, which would hide a broken release.
  const folder = resolve(migrationsFolder);
  if (!(await hasMigrations(folder))) {
    throw new Error(`No migrations found in ${folder}`);
  }
  // Migrations such as index builds may take longer than the normal statement timeout.
  const { db, pool } = createDb(databaseUrl, { statementTimeoutMs: 0 });
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}
