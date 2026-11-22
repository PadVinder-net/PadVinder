import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { runMigrations } from "./migrate";
import { createTestDatabase, type TestDatabase } from "./testing";

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

test("migrates a database that already holds data in the old shape", async () => {
  // Start from an empty database with only the first two migrations, add a row, then migrate on.
  const old = await createTestDatabase();
  const firstTwo = await mkdtemp(join(tmpdir(), "padvinder-old-migrations-"));
  try {
    const all = join(import.meta.dirname, "..", "drizzle");
    const names = (await readdir(all, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of names.slice(0, 2))
      await cp(join(all, name), join(firstTwo, name), { recursive: true });
    await old.db.execute(sql`drop schema if exists drizzle cascade`);
    await old.db.execute(sql`drop schema public cascade`);
    await old.db.execute(sql`create schema public`);
    await runMigrations(old.url, firstTwo);
    await old.db.execute(
      sql`insert into worker_heartbeats (beat_at) values ('2027-01-10T19:00:00Z')`,
    );

    await runMigrations(old.url);

    const heartbeats = await old.pool.query("select count(*)::int as n from worker_heartbeats");
    expect(heartbeats.rows[0]).toEqual({ n: 1 });
    const tables = await old.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('users', 'login_code_requests')",
    );
    expect(tables.rows).toHaveLength(2);
  } finally {
    await rm(firstTwo, { recursive: true });
    await old.drop();
  }
});
