import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { afterAll, beforeAll, expect, test } from "vitest";
import { recordQueries } from "./query-log";

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

async function inTransaction(): Promise<void> {
  const client = await t.pool.connect();
  try {
    await client.query("begin");
    await client.query("select 1 as in_transaction");
    await client.query("commit");
  } finally {
    client.release();
  }
}

test("two consecutive recordings both see a transaction query on a reused connection", async () => {
  const first = await recordQueries(t.pool, inTransaction);
  const second = await recordQueries(t.pool, inTransaction);
  expect(first).toContain("select 1 as in_transaction");
  expect(second).toContain("select 1 as in_transaction");
  // Nothing from the second run ended up in the first recording.
  expect(first.filter((q) => q === "select 1 as in_transaction")).toHaveLength(1);
  // And outside a recording nothing is written anywhere.
  await inTransaction();
  expect(first.filter((q) => q === "select 1 as in_transaction")).toHaveLength(1);
});

test("a pool query is recorded", async () => {
  const log = await recordQueries(t.pool, () => t.pool.query("select 2 as plain"));
  expect(log).toEqual(["select 2 as plain"]);
});
