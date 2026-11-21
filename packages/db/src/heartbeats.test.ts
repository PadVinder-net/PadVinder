import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { getLatestHeartbeat, recordHeartbeat } from "./heartbeats";
import { liveEventsChannel } from "./notifications";
import { workerHeartbeats } from "./schema";
import { seed } from "./seed";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
// Tests in this file share one clone and need an empty table each.
beforeEach(async () => {
  await t!.db.delete(workerHeartbeats);
});
afterAll(async () => {
  await t?.drop();
});

test("latest is null on an empty table", async () =>
  expect(await getLatestHeartbeat(t!.db)).toBeNull());

test("records and reads back the latest beat", async () => {
  const at = new Date("2027-03-01T19:30:00Z");
  await recordHeartbeat(t!.db, at);
  expect(await getLatestHeartbeat(t!.db)).toEqual(at);
});

test("recording the same beat twice keeps one row", async () => {
  const at = new Date();
  await recordHeartbeat(t!.db, at);
  await recordHeartbeat(t!.db, at);
  expect(await t!.db.select().from(workerHeartbeats)).toHaveLength(1);
});

test("prunes beats older than 7 days", async () => {
  await recordHeartbeat(t!.db, new Date(Date.now() - 8 * 86_400_000));
  await recordHeartbeat(t!.db);
  const rows = await t!.db.select().from(workerHeartbeats);
  expect(rows).toHaveLength(1);
});

test("notifies listeners with an event matching the contract", async () => {
  const listener = new pg.Client({ connectionString: t!.url });
  await listener.connect();
  try {
    const received = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No notification received")), 3_000);
      listener.on("notification", (message) => {
        clearTimeout(timer);
        resolve(message.payload ?? "");
      });
    });
    await listener.query(`LISTEN ${liveEventsChannel.name}`);
    const at = new Date("2027-03-01T19:30:00Z");
    await recordHeartbeat(t!.db, at);
    const payload = await received;
    expect(liveEventsChannel.schema.parse(JSON.parse(payload))).toEqual({
      type: "worker-heartbeat",
      beatAt: at.toISOString(),
    });
  } finally {
    await listener.end();
  }
});

test("seed runs twice without error", async () => {
  await seed(t!.db);
  await seed(t!.db);
});
