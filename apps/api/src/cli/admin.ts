/**
 * The maintainer's tool for organizations, working groups and roles. It needs only DATABASE_URL:
 *
 *   node --env-file=release.env --env-file=../../.env api/dist/admin.js list
 *
 * Locally: `pnpm admin <command>` from the repository root.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createDb } from "@padvinder/db";
import { runAdminCommand } from "./run-admin-command";

/** The message with its causes on one line each; Drizzle hides the real error in the cause. */
function describe(error: unknown): string {
  const lines: string[] = [];
  for (let e = error, depth = 0; depth < 8; depth++) {
    if (!(e instanceof Error)) {
      lines.push(String(e));
      break;
    }
    lines.push(e.message || e.name);
    if (e.cause === undefined) break;
    e = e.cause;
  }
  return lines.join("\ncaused by: ");
}

/** Reads DATABASE_URL, runs the command from argv and returns the exit code. */
async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    return 1;
  }
  const { db, pool } = createDb(databaseUrl);
  try {
    return await runAdminCommand(process.argv.slice(2), {
      db,
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  } catch (error) {
    console.error(describe(error));
    return 1;
  } finally {
    await pool.end();
  }
}

function isMain(): boolean {
  const script = process.argv[1];
  return script !== undefined && import.meta.url === pathToFileURL(realpathSync(script)).href;
}

if (isMain()) process.exitCode = await main();
