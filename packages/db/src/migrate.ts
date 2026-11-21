import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type Db } from "./client";

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

/**
 * Refuses a database whose encoding or locale is not UTF8 and C.UTF-8. Both can only be set
 * when a database is created, and sorting and text comparison depend on them, so a wrong
 * one must be caught before the first migration writes anything.
 */
async function checkDatabaseLocale(db: Db): Promise<void> {
  const { rows } = await db.execute<{
    name: string;
    encoding: string;
    collate: string;
    ctype: string;
  }>(
    sql`select datname as name, pg_encoding_to_char(encoding) as encoding,
               datcollate as collate, datctype as ctype
          from pg_database where datname = current_database()`,
  );
  const [database] = rows;
  if (!database) throw new Error("Could not read the current database from pg_database");
  const { name, encoding, collate, ctype } = database;
  if (encoding !== "UTF8" || collate !== "C.UTF-8" || ctype !== "C.UTF-8") {
    throw new Error(
      `Database ${name} has encoding/locale ${encoding}/${collate}/${ctype}; PadVinder requires UTF8 with locale C.UTF-8. Recreate it with that locale before migrating.`,
    );
  }
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
    await checkDatabaseLocale(db);
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}
