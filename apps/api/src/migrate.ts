import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runMigrations } from "@padvinder/db";

/**
 * Applies the database migrations of a release, before its services start:
 *
 *   node --env-file=release.env --env-file=<secrets env> api/dist/migrate.js migrations
 *
 * The folder is an argument because a bundled `@padvinder/db` cannot find its own.
 */
export function parseMigrateArgs(argv: readonly string[]): { migrationsFolder: string } {
  const [folder] = argv;
  if (!folder) throw new Error("Usage: node dist/migrate.js <migrations-folder>");
  return { migrationsFolder: resolve(folder) };
}

async function main(): Promise<void> {
  const { migrationsFolder } = parseMigrateArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
  await runMigrations(databaseUrl, migrationsFolder);
  console.log("Migrations are up to date.");
}

/** Whether this module is the program Node runs, not an import (from a test). */
function isMain(): boolean {
  const script = process.argv[1];
  // Node loads the real path of the script, also when it is started through a symlink
  // (such as a `current` release link), so compare real paths.
  return script !== undefined && import.meta.url === pathToFileURL(realpathSync(script)).href;
}

if (isMain()) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
