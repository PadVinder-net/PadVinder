import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { formatError, parseMigrateArgs } from "./migrate";

test("requires the migrations folder", () =>
  expect(() => parseMigrateArgs([])).toThrow("Usage: node dist/migrate.js <migrations-folder>"));

test("resolves the folder to an absolute path", () =>
  expect(parseMigrateArgs(["migrations"]).migrationsFolder).toBe(resolve("migrations")));

test("keeps an absolute folder", () =>
  expect(parseMigrateArgs(["/srv/release/migrations"]).migrationsFolder).toBe(
    "/srv/release/migrations",
  ));

test("formats the cause chain of a wrapped query error", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
    code: "ECONNREFUSED",
  });
  // Node's dual-stack connect gives an AggregateError with an empty message.
  const connect = Object.assign(new AggregateError([refused], ""), { code: "ECONNREFUSED" });
  const query = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"', {
    cause: connect,
  });
  expect(formatError(query)).toBe(
    [
      'Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"',
      "  caused by: AggregateError (ECONNREFUSED)",
      "    connect ECONNREFUSED 127.0.0.1:1 (ECONNREFUSED)",
    ].join("\n"),
  );
});

test("formats a plain error as its message, and a non-error as a string", () => {
  expect(formatError(new Error("DATABASE_URL is not set."))).toBe("DATABASE_URL is not set.");
  expect(formatError("oops")).toBe("oops");
});

/** Runs migrate.ts as a program, the way node runs dist/migrate.js, with only the given env. */
async function runMigrate(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/migrate.ts", ...args], {
    cwd: `${import.meta.dirname}/..`,
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, stderr };
}

const migrations = `${import.meta.dirname}/../../../packages/db/drizzle`;

test("exits 1 when DATABASE_URL is not set", async () => {
  const { code, stderr } = await runMigrate([migrations], {});
  expect(code).toBe(1);
  expect(stderr.trim()).toBe("DATABASE_URL is not set.");
}, 15_000);

test("exits 1 naming the real cause when the database is unreachable", async () => {
  // Port 1 refuses connections.
  const { code, stderr } = await runMigrate([migrations], {
    DATABASE_URL: "postgres://x:y@localhost:1/none",
  });
  expect(code).toBe(1);
  expect(stderr).toMatch(/^Failed query: /);
  expect(stderr).toMatch(/ECONNREFUSED/);
}, 15_000);
