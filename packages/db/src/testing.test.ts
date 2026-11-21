import pg from "pg";
import { expect, test } from "vitest";
import { getLatestHeartbeat, recordHeartbeat } from "./heartbeats";
import { createTestDatabase } from "./testing";

async function databaseExists(url: string): Promise<boolean> {
  const name = new URL(url).pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const result = await client.query("select 1 from pg_database where datname = $1", [name]);
    return result.rowCount === 1;
  } finally {
    await client.end();
  }
}

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
