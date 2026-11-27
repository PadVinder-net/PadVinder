import { afterAll, beforeAll, expect, test } from "vitest";
import {
  countLoginCodeRequests,
  lockLoginCodeRequests,
  pruneLoginData,
  recordLoginCodeRequest,
} from "./login-code-requests";
import { rateLimits, verifications } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

const now = new Date("2027-01-10T19:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const countAll = async (email: string) =>
  (await countLoginCodeRequests(t!.db, email, { all: new Date(0) })).all;

test("counts requests for one address since several moments in one call", async () => {
  await recordLoginCodeRequest(t!.db, "a@example.test", minutesAgo(20));
  await recordLoginCodeRequest(t!.db, "a@example.test", minutesAgo(5));
  await recordLoginCodeRequest(t!.db, "a@example.test", minutesAgo(25 * 60));
  await recordLoginCodeRequest(t!.db, "b@example.test", now);
  expect(
    await countLoginCodeRequests(t!.db, "a@example.test", {
      quarterHour: minutesAgo(15),
      day: minutesAgo(24 * 60),
    }),
  ).toEqual({ quarterHour: 1, day: 2 });
});

test("an address without requests counts zero", async () => {
  expect(
    await countLoginCodeRequests(t!.db, "none@example.test", { day: minutesAgo(24 * 60) }),
  ).toEqual({ day: 0 });
});

test("pruning deletes only requests and IP counters older than 24 hours", async () => {
  await recordLoginCodeRequest(t!.db, "prune@example.test", minutesAgo(25 * 60));
  await recordLoginCodeRequest(t!.db, "prune@example.test", minutesAgo(23 * 60));
  await t!.db.insert(rateLimits).values([
    { key: "old", count: 1, lastRequest: minutesAgo(25 * 60).getTime() },
    { key: "recent", count: 1, lastRequest: minutesAgo(23 * 60).getTime() },
  ]);
  await pruneLoginData(t!.db, now);
  expect(await countAll("prune@example.test")).toBe(1);
  expect((await t!.db.select().from(rateLimits)).map((row) => row.key)).toEqual(["recent"]);
});

test("pruneLoginData deletes expired challenge rows and keeps a valid login code", async () => {
  const row = (identifier: string, expiresAt: Date) => ({ identifier, value: "v", expiresAt });
  await t!.db
    .insert(verifications)
    .values([
      row("challenge-old", minutesAgo(25 * 60)),
      row("challenge-just-expired", minutesAgo(60)),
      row("sign-in-otp-valid@example.test", new Date(now.getTime() + 20 * 60_000)),
    ]);
  await pruneLoginData(t!.db, now);
  const identifiers = (await t!.db.select().from(verifications)).map((r) => r.identifier);
  expect(identifiers).not.toContain("challenge-old");
  expect(identifiers).toContain("challenge-just-expired");
  expect(identifiers).toContain("sign-in-otp-valid@example.test");
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
