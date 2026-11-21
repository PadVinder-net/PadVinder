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

/** Deep enough for any real chain; stops a cycle of causes. */
const MAX_DEPTH = 8;

function describe(error: Error): string {
  const code = (error as { code?: unknown }).code;
  // Node's dual-stack connect gives an AggregateError with an empty message.
  return `${error.message || error.name}${code ? ` (${String(code)})` : ""}`;
}

function formatLines(error: unknown, depth: number, label: string): string[] {
  const line = `${"  ".repeat(depth)}${label}`;
  if (!(error instanceof Error)) return [`${line}${String(error)}`];
  const lines = [`${line}${describe(error)}`];
  if (depth >= MAX_DEPTH) return lines;
  if (error instanceof AggregateError) {
    for (const inner of error.errors) lines.push(...formatLines(inner, depth + 1, ""));
  }
  if (error.cause !== undefined) lines.push(...formatLines(error.cause, depth + 1, "caused by: "));
  return lines;
}

/**
 * The message with its chain of causes, one per line. Drizzle wraps every failure in an error
 * that only says `Failed query: <sql>`; the Postgres or connection error is in its cause.
 */
export function formatError(error: unknown): string {
  return formatLines(error, 0, "").join("\n");
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
    console.error(formatError(error));
    process.exit(1);
  }
}
