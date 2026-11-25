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

test("the membership request migration applies to a database that already holds users and memberships", async () => {
  const old = await createTestDatabase();
  const folder = await mkdtemp(join(tmpdir(), "padvinder-old-migrations-"));
  try {
    const all = join(import.meta.dirname, "..", "drizzle");
    const names = (await readdir(all, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const first = names.findIndex((n) => n.endsWith("_membership_requests"));
    expect(first).toBeGreaterThan(0);
    for (const name of names.slice(0, first))
      await cp(join(all, name), join(folder, name), { recursive: true });
    await old.db.execute(sql`drop schema if exists drizzle cascade`);
    await old.db.execute(sql`drop schema public cascade`);
    await old.db.execute(sql`create schema public`);
    await runMigrations(old.url, folder);
    const user = await old.pool.query(
      "insert into users (name, email, email_verified) values ('Oud', 'member@example.test', true) returning id",
    );
    const org = await old.pool.query(
      "insert into organizations (name) values ('Oude organisatie') returning id",
    );
    const group = await old.pool.query(
      "insert into working_groups (organization_id, name, city) values ($1, 'Oud', 'Voorbeeldstad') returning id",
      [org.rows[0].id],
    );
    await old.pool.query(
      "insert into working_group_memberships (user_id, working_group_id) values ($1, $2)",
      [user.rows[0].id, group.rows[0].id],
    );

    await runMigrations(old.url);

    const rows = await old.pool.query(
      "select u.deleted_at, (select count(*)::int from working_group_memberships) as memberships, (select count(*)::int from membership_requests) as requests from users u",
    );
    expect(rows.rows).toEqual([{ deleted_at: null, memberships: 1, requests: 0 }]);
  } finally {
    await rm(folder, { recursive: true });
    await old.drop();
  }
});

test("the species migrations apply to a database that already holds users, organizations and audit entries", async () => {
  const old = await createTestDatabase();
  const folder = await mkdtemp(join(tmpdir(), "padvinder-old-migrations-"));
  try {
    const all = join(import.meta.dirname, "..", "drizzle");
    const names = (await readdir(all, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    // The table migration (`_species`) comes before the one with the rows (`_official_species`).
    const first = names.findIndex((n) => n.endsWith("_species"));
    expect(first).toBeGreaterThan(0);
    expect(names[first + 1]).toMatch(/_official_species$/);
    for (const name of names.slice(0, first))
      await cp(join(all, name), join(folder, name), { recursive: true });
    await old.db.execute(sql`drop schema if exists drizzle cascade`);
    await old.db.execute(sql`drop schema public cascade`);
    await old.db.execute(sql`create schema public`);
    await runMigrations(old.url, folder);
    const user = await old.pool.query(
      "insert into users (name, email, email_verified) values ('Oud', 'species@example.test', true) returning id",
    );
    const org = await old.pool.query(
      "insert into organizations (name) values ('Oude organisatie') returning id",
    );
    await old.pool.query(
      "insert into audit_log_entries (actor_kind, actor_user_id, organization_id, action, subject_type, subject_id) values ('user', $1, $2, 'organization.created', 'organization', $2)",
      [user.rows[0].id, org.rows[0].id],
    );

    await runMigrations(old.url);

    const rows = await old.pool.query(
      "select (select count(*)::int from users) as users, (select count(*)::int from organizations) as organizations, (select count(*)::int from audit_log_entries) as entries, (select count(*)::int from species) as species",
    );
    expect(rows.rows).toEqual([{ users: 1, organizations: 1, entries: 1, species: 5 }]);
  } finally {
    await rm(folder, { recursive: true });
    await old.drop();
  }
});

test("the last_login_at migration gives each user the newest session's start, or null", async () => {
  const old = await createTestDatabase();
  const folder = await mkdtemp(join(tmpdir(), "padvinder-old-migrations-"));
  try {
    const all = join(import.meta.dirname, "..", "drizzle");
    const names = (await readdir(all, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const column = names.findIndex((n) => n.endsWith("_last_login_at"));
    expect(column).toBeGreaterThan(0);
    expect(names[column + 1]).toMatch(/_backfill_last_login_at$/);
    for (const name of names.slice(0, column))
      await cp(join(all, name), join(folder, name), { recursive: true });
    await old.db.execute(sql`drop schema if exists drizzle cascade`);
    await old.db.execute(sql`drop schema public cascade`);
    await old.db.execute(sql`create schema public`);
    await runMigrations(old.url, folder);
    const user = async (email: string) =>
      (
        await old.pool.query(
          "insert into users (name, email, email_verified) values ('Oud', $1, true) returning id",
          [email],
        )
      ).rows[0].id as string;
    const withSessions = await user("sessies@example.test");
    const without = await user("zonder@example.test");
    for (const [token, createdAt] of [
      ["oud", "2026-10-01T10:00:00Z"],
      ["nieuw", "2026-11-01T10:00:00Z"],
    ] as const) {
      await old.pool.query(
        "insert into sessions (token, expires_at, created_at, user_id) values ($1, '2027-06-01T00:00:00Z', $2, $3)",
        [token, createdAt, withSessions],
      );
    }

    await runMigrations(old.url);

    const rows = await old.pool.query("select id, last_login_at from users where id = any($1)", [
      [withSessions, without],
    ]);
    const byId = new Map(rows.rows.map((r) => [r.id, r.last_login_at as Date | null]));
    expect(byId.get(withSessions)?.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(byId.get(without)).toBeNull();
  } finally {
    await rm(folder, { recursive: true });
    await old.drop();
  }
});

/**
 * A fresh database migrated up to, not including, the migration whose folder ends in `suffix`,
 * and the folder of the migrations it got. The caller drops the database and removes the folder.
 */
async function migratedBefore(suffix: string) {
  const old = await createTestDatabase();
  const folder = await mkdtemp(join(tmpdir(), "padvinder-old-migrations-"));
  const all = join(import.meta.dirname, "..", "drizzle");
  const names = (await readdir(all, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const index = names.findIndex((n) => n.endsWith(suffix));
  expect(index).toBeGreaterThan(0);
  for (const name of names.slice(0, index))
    await cp(join(all, name), join(folder, name), { recursive: true });
  await old.db.execute(sql`drop schema if exists drizzle cascade`);
  await old.db.execute(sql`drop schema public cascade`);
  await old.db.execute(sql`create schema public`);
  await runMigrations(old.url, folder);
  return {
    old,
    async cleanUp() {
      await rm(folder, { recursive: true });
      await old.drop();
    },
  };
}

test("the organization contact migration applies to a database that holds organizations", async () => {
  const { old, cleanUp } = await migratedBefore("_organization_contact_and_unique_name");
  try {
    await old.pool.query(
      "insert into organizations (name) values ('Paddentrek Voorbeeldstad'), ('Paddenwerkgroep Fictiefdorp')",
    );

    await runMigrations(old.url);

    const rows = await old.pool.query(
      "select name, contact_email from organizations order by name",
    );
    expect(rows.rows).toEqual([
      { name: "Paddentrek Voorbeeldstad", contact_email: null },
      { name: "Paddenwerkgroep Fictiefdorp", contact_email: null },
    ]);
    await expect(
      old.pool.query("insert into organizations (name) values ('PADDENTREK voorbeeldstad')"),
    ).rejects.toMatchObject({ code: "23505", constraint: "organizations_name_key" });
  } finally {
    await cleanUp();
  }
});

test("the organization contact migration fails when two names differ only in capitals", async () => {
  const { old, cleanUp } = await migratedBefore("_organization_contact_and_unique_name");
  try {
    await old.pool.query(
      "insert into organizations (name) values ('Paddentrek Voorbeeldstad'), ('paddentrek voorbeeldstad')",
    );
    await expect(runMigrations(old.url)).rejects.toThrow();
    const column = await old.pool.query(
      "select 1 from information_schema.columns where table_name = 'organizations' and column_name = 'contact_email'",
    );
    expect(column.rows).toEqual([]);
  } finally {
    await cleanUp();
  }
});

/** Inserts organizations and their working groups; returns the organization IDs by name. */
async function insertGroups(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: { id: string }[] }> },
  groups: Record<string, string[]>,
) {
  const ids: Record<string, string> = {};
  for (const [organization, names] of Object.entries(groups)) {
    const { rows } = await pool.query("insert into organizations (name) values ($1) returning id", [
      organization,
    ]);
    ids[organization] = rows[0]!.id;
    for (const name of names) {
      await pool.query(
        "insert into working_groups (organization_id, name, city) values ($1, $2, 'Voorbeeldstad')",
        [ids[organization], name],
      );
    }
  }
  return ids;
}

test("the working group name migration applies to a database that holds working groups", async () => {
  const { old, cleanUp } = await migratedBefore("_working_group_unique_name");
  try {
    // The same name in two organizations is fine, before and after.
    const ids = await insertGroups(old.pool, {
      "Paddentrek Voorbeeldstad": ["Noord", "Zuid"],
      "Paddenwerkgroep Fictiefdorp": ["Noord"],
    });

    await runMigrations(old.url);

    const rows = await old.pool.query("select name from working_groups order by name");
    expect(rows.rows).toEqual([{ name: "Noord" }, { name: "Noord" }, { name: "Zuid" }]);
    await expect(
      old.pool.query(
        "insert into working_groups (organization_id, name, city) values ($1, 'NOORD', 'X')",
        [ids["Paddentrek Voorbeeldstad"]],
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "working_groups_name_key" });
  } finally {
    await cleanUp();
  }
});

test("the working group name migration fails when two names in one organization differ only in capitals", async () => {
  const { old, cleanUp } = await migratedBefore("_working_group_unique_name");
  try {
    await insertGroups(old.pool, { "Paddentrek Voorbeeldstad": ["Noord", "noord"] });
    await expect(runMigrations(old.url)).rejects.toThrow();
    // One transaction: the old constraint is still there, the new index is not.
    const indexes = await old.pool.query(
      "select indexname from pg_indexes where tablename = 'working_groups' order by indexname",
    );
    expect(indexes.rows.map((row: { indexname: string }) => row.indexname)).toEqual([
      "working_groups_organization_id_name_key",
      "working_groups_pkey",
    ]);
  } finally {
    await cleanUp();
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
