import { afterAll, beforeAll, expect, test } from "vitest";
import { countLoginCodeRequests, recordLoginCodeRequest } from "./login-code-requests";
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
