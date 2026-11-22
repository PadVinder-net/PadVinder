import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { runMigrations } from "./migrate";
import { createTestDatabase, newTestDatabaseName, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

test("runs twice without error", async () => {
  await runMigrations(t!.url);
  await expect(runMigrations(t!.url)).resolves.toBeUndefined();
});

test("runs migrations without a statement timeout", async () => {
  const folder = await mkdtemp(join(tmpdir(), "padvinder-migrations-"));
  try {
    await mkdir(join(folder, "20990101000000_probe"));
    // Fails on purpose, so the probe leaves no row in the migrations table.
    await writeFile(
      join(folder, "20990101000000_probe", "migration.sql"),
      `DO $$ BEGIN
  IF current_setting('statement_timeout') <> '0' THEN
    RAISE EXCEPTION 'statement_timeout is set';
  END IF;
  RAISE EXCEPTION 'probe finished';
END $$;`,
    );
    await expect(runMigrations(t!.url, folder)).rejects.toThrow(/probe finished/);
  } finally {
    await rm(folder, { recursive: true });
  }
});

test("rejects a folder without migrations", async () => {
  const empty = await mkdtemp(join(tmpdir(), "no-migrations-"));
  try {
    await expect(runMigrations(t!.url, empty)).rejects.toThrow(`No migrations found in ${empty}`);
  } finally {
    await rm(empty, { recursive: true });
  }
});

test("rejects a folder that does not exist", async () => {
  const missing = join(tmpdir(), "padvinder-missing-migrations");
  await expect(runMigrations(t!.url, missing)).rejects.toThrow(`No migrations found in ${missing}`);
});

test("rejects a folder without migrations before connecting", async () => {
  const missing = join(tmpdir(), "padvinder-missing-migrations");
  // Port 1 refuses connections, so a connection attempt would fail with another error.
  await expect(runMigrations("postgres://x:y@127.0.0.1:1/none", missing)).rejects.toThrow(
    /No migrations found/,
  );
});

test("refuses a database whose locale is not C.UTF-8, before migrating", async () => {
  const admin = new URL(t!.url);
  // A test database name, so the cleanup drops it if this run is interrupted.
  const name = newTestDatabaseName();
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(
      `create database "${name}" template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
    );
    const url = new URL(t!.url);
    url.pathname = `/${name}`;
    const error = (await runMigrations(url.toString()).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe(
      `Database ${name} has encoding/locale UTF8/C/C; PadVinder requires UTF8 with locale C.UTF-8. Recreate it with that locale before migrating.`,
    );
    // Nothing was migrated.
    const check = new pg.Client({ connectionString: url.toString() });
    await check.connect();
    try {
      const { rows } = await check.query("select to_regnamespace('drizzle') as schema");
      expect(rows[0].schema).toBeNull();
    } finally {
      await check.end();
    }
  } finally {
    await client.query(`drop database if exists "${name}" with (force)`);
    await client.end();
  }
});

test("accepts the test database, which has UTF8 and C.UTF-8", async () => {
  await expect(runMigrations(t!.url)).resolves.toBeUndefined();
});
