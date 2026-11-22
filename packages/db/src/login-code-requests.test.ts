import { afterAll, beforeAll, expect, test } from "vitest";
import {
  countLoginCodeRequests,
  lockLoginCodeRequests,
  pruneLoginCodeRequests,
  recordLoginCodeRequest,
} from "./login-code-requests";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

const now = new Date("2027-01-10T19:00:00Z");

test("counts requests for one address since a moment", async () => {
  await recordLoginCodeRequest(t!.db, "a@example.test", new Date(now.getTime() - 20 * 60_000));
  await recordLoginCodeRequest(t!.db, "a@example.test", new Date(now.getTime() - 5 * 60_000));
  await recordLoginCodeRequest(t!.db, "b@example.test", now);
  expect(
    await countLoginCodeRequests(t!.db, "a@example.test", new Date(now.getTime() - 15 * 60_000)),
  ).toBe(1);
});

test("rows older than 24 hours are pruned on the next record", async () => {
  await recordLoginCodeRequest(t!.db, "old@example.test", new Date(now.getTime() - 25 * 3_600_000));
  await recordLoginCodeRequest(t!.db, "new@example.test", now);
  expect(await countLoginCodeRequests(t!.db, "old@example.test", new Date(0))).toBe(0);
});

test("pruning deletes only rows older than 24 hours", async () => {
  await recordLoginCodeRequest(
    t!.db,
    "prune@example.test",
    new Date(now.getTime() - 25 * 3_600_000),
  );
  await recordLoginCodeRequest(
    t!.db,
    "prune@example.test",
    new Date(now.getTime() - 23 * 3_600_000),
  );
  await pruneLoginCodeRequests(t!.db, now);
  expect(await countLoginCodeRequests(t!.db, "prune@example.test", new Date(0))).toBe(1);
});

test("the lock for one address makes a second transaction wait", async () => {
  const order: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const first = new Promise<void>((resolve) => (locked = resolve));
  const a = t!.db.transaction(async (tx) => {
    await lockLoginCodeRequests(tx, "lock@example.test");
    locked();
    await held;
    order.push("a");
  });
  await first;
  const b = t!.db.transaction(async (tx) => {
    await lockLoginCodeRequests(tx, "lock@example.test");
    order.push("b");
  });
  // Another address is not held up.
  await t!.db.transaction(async (tx) => {
    await lockLoginCodeRequests(tx, "other@example.test");
    order.push("other");
  });
  release();
  await Promise.all([a, b]);
  expect(order).toEqual(["other", "a", "b"]);
});
