import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
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

test("the migration applies to a database that already holds users and sessions", async () => {
  const old = await createTestDatabase();
  const folder = await mkdtemp(join(tmpdir(), "padvinder-old-migrations-"));
  try {
    const all = join(import.meta.dirname, "..", "drizzle");
    const names = (await readdir(all, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    // Everything before the migration that adds the access tables (later ones depend on it).
    for (const name of names.slice(
      0,
      names.findIndex((n) => n.endsWith("_access_tables_and_audit_log")),
    ))
      await cp(join(all, name), join(folder, name), { recursive: true });
    await old.db.execute(sql`drop schema if exists drizzle cascade`);
    await old.db.execute(sql`drop schema public cascade`);
    await old.db.execute(sql`create schema public`);
    await runMigrations(old.url, folder);
    const user = await old.pool.query(
      "insert into users (name, email, email_verified) values ('', 'old@example.test', true) returning id",
    );
    await old.pool.query(
      "insert into sessions (expires_at, token, user_id) values ('2027-06-01T00:00:00Z', 'tok', $1)",
      [user.rows[0].id],
    );

    await runMigrations(old.url);

    const rows = await old.pool.query(
      "select u.is_platform_admin, (select count(*)::int from sessions) as sessions from users u",
    );
    expect(rows.rows).toEqual([{ is_platform_admin: false, sessions: 1 }]);
    const tables = await old.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('organizations', 'working_groups', 'working_group_memberships', 'organization_admins')",
    );
    expect(tables.rows).toHaveLength(4);
  } finally {
    await rm(folder, { recursive: true });
    await old.drop();
  }
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
