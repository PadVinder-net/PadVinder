import { randomInt } from "node:crypto";
import pg from "pg";
import { expect, test } from "vitest";
import { getLatestHeartbeat, recordHeartbeat } from "./heartbeats";
import {
  createTestDatabase,
  dropTestDatabases,
  isTestDatabaseName,
  newTestDatabaseName,
} from "./testing";

const databaseName = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1));

async function withAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const admin = new URL(process.env.TEST_DATABASE_URL!);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function databaseExists(url: string): Promise<boolean> {
  return withAdmin(async (client) => {
    const result = await client.query("select 1 from pg_database where datname = $1", [
      databaseName(url),
    ]);
    return result.rowCount === 1;
  });
}

const letters = (length: number) =>
  Array.from({ length }, () => String.fromCharCode(97 + randomInt(26))).join("");

test("a clone has the migrated schema", async () => {
  const t = await createTestDatabase();
  try {
    expect(await getLatestHeartbeat(t.db)).toBeNull();
  } finally {
    await t.drop();
  }
});

test("clones are isolated from each other", async () => {
  const [a, b] = await Promise.all([createTestDatabase(), createTestDatabase()]);
  try {
    await recordHeartbeat(a.db);
    expect(await getLatestHeartbeat(b.db)).toBeNull();
  } finally {
    await Promise.all([a.drop(), b.drop()]);
  }
});

test("eight concurrent clones succeed (no 'being accessed by other users')", async () => {
  const dbs = await Promise.all(Array.from({ length: 8 }, () => createTestDatabase()));
  await Promise.all(dbs.map((d) => d.drop()));
});

test("drop removes the clone", async () => {
  const t = await createTestDatabase();
  expect(await databaseExists(t.url)).toBe(true);
  await t.drop();
  expect(await databaseExists(t.url)).toBe(false);
});

test("drop twice is harmless", async () => {
  const t = await createTestDatabase();
  await t.drop();
  await expect(t.drop()).resolves.toBeUndefined();
  expect(await databaseExists(t.url)).toBe(false);
});

test("drop removes the clone even when closing the pool fails", async () => {
  const t = await createTestDatabase();
  // Ending a pool twice throws, so drop's own pool.end() fails.
  await t.pool.end();
  await expect(t.drop()).rejects.toThrow();
  expect(await databaseExists(t.url)).toBe(false);
});

test("a test database name is the template's name, '_' and 8 lowercase letters", () => {
  const template = databaseName(process.env.TEST_DATABASE_URL!);
  const name = newTestDatabaseName();
  expect(name).toMatch(new RegExp(`^${template}_[a-z]{8}$`));
  expect(isTestDatabaseName(name)).toBe(true);
  expect(newTestDatabaseName()).not.toBe(name);
});

test("only test database names match, never the template or the dev database", () => {
  const template = databaseName(process.env.TEST_DATABASE_URL!);
  // The workspace's dev database, as scripts/setup-workspace.sh names it.
  const dev = databaseName(process.env.DATABASE_URL ?? template.replace(/_test$/, ""));
  for (const name of [
    template,
    dev,
    `${template}_abcdefg`,
    `${template}_abcdefghi`,
    `${template}_ABCDEFGH`,
    `${template}_abcdefgh_c`,
    `${template}x_abcdefgh`,
    `x${template}_abcdefgh`,
    // A clone of a workspace named "<workspace>_test".
    `${template}_test_abcdefgh`,
    `${dev}_abcdefgh`,
  ]) {
    expect(isTestDatabaseName(name), name).toBe(false);
  }
  // The template name is literal text, not a pattern.
  expect(isTestDatabaseName("axb_abcdefgh", "a.b")).toBe(false);
  expect(isTestDatabaseName("a.b_abcdefgh", "a.b")).toBe(true);
});

test("dropTestDatabases drops leftover test databases of the template, and not the template", async () => {
  // A made-up template: the real one's test databases belong to tests that are running now.
  const template = `padvinder_probe_${letters(8)}`;
  const leftover = `${template}_${letters(8)}`;
  const urlOf = (name: string) => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = `/${name}`;
    return url.toString();
  };
  try {
    await withAdmin(async (client) => {
      for (const name of [template, leftover]) await client.query(`create database "${name}"`);
    });
    await dropTestDatabases(template);
    expect(await databaseExists(urlOf(leftover))).toBe(false);
    expect(await databaseExists(urlOf(template))).toBe(true);
  } finally {
    await withAdmin(async (client) => {
      for (const name of [template, leftover])
        await client.query(`drop database if exists "${name}" with (force)`);
    });
  }
}, 30_000);
