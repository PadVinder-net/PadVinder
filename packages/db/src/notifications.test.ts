import pg from "pg";
import { z } from "zod";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  defineChannel,
  notify,
  liveEventsChannel,
  type NotificationChannel,
} from "./notifications";
import { createTestDatabase, type TestDatabase } from "./testing";

const testChannel = defineChannel("test_channel", z.object({ text: z.string() }));
// `{"text":""}` is 11 bytes.
const JSON_OVERHEAD_BYTES = 11;

let t: TestDatabase | undefined;
let listener: pg.Client | undefined;
const payloads: string[] = [];
let arrived: (() => void) | undefined;

beforeAll(async () => {
  t = await createTestDatabase();
  listener = new pg.Client({ connectionString: t.url });
  await listener.connect();
  listener.on("notification", (message) => {
    payloads.push(message.payload ?? "");
    arrived?.();
  });
  await listener.query(`LISTEN ${testChannel.name}`);
  await listener.query(`LISTEN ${liveEventsChannel.name}`);
});
afterAll(async () => {
  await listener?.end();
  await t?.drop();
});

/** Sends in a transaction of its own, the way a caller commits a change and its notification. */
function send<S extends z.ZodType>(channel: NotificationChannel<S>, payload: z.input<S>) {
  return t!.db.transaction((tx) => notify(tx, channel, payload));
}

/** The next payload in arrival order; rejects after 3 seconds. */
async function nextPayload(): Promise<string> {
  if (payloads.length === 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No notification received")), 3_000);
      arrived = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  return payloads.shift()!;
}

test("delivers a payload that parses with the channel schema", async () => {
  const event = { type: "worker-heartbeat", beatAt: "2027-03-01T19:30:00.000Z" } as const;
  await send(liveEventsChannel, event);
  expect(liveEventsChannel.schema.parse(JSON.parse(await nextPayload()))).toEqual(event);
});

// Each test below sends a valid marker afterwards: if the first notification had been sent, it
// would arrive before the marker.

test("delivers nothing when the transaction rolls back", async () => {
  await expect(
    t!.db.transaction(async (tx) => {
      await notify(tx, testChannel, { text: "rolled back" });
      throw new Error("roll back");
    }),
  ).rejects.toThrow("roll back");
  await send(testChannel, { text: "marker" });
  expect(JSON.parse(await nextPayload())).toEqual({ text: "marker" });
});

test("a payload that does not match the schema throws and sends nothing", async () => {
  await expect(
    // @ts-expect-error: the wrong shape on purpose.
    send(testChannel, { text: 1 }),
  ).rejects.toThrow(z.ZodError);
  await send(testChannel, { text: "marker" });
  expect(JSON.parse(await nextPayload())).toEqual({ text: "marker" });
});

test("accepts a payload just under 8000 bytes and rejects one of 8000", async () => {
  const largest = "x".repeat(7_999 - JSON_OVERHEAD_BYTES);
  await send(testChannel, { text: largest });
  expect(JSON.parse(await nextPayload())).toEqual({ text: largest });
  await expect(send(testChannel, { text: `${largest}x` })).rejects.toThrow(
    /test_channel.*8000 bytes/,
  );
  await send(testChannel, { text: "marker" });
  expect(JSON.parse(await nextPayload())).toEqual({ text: "marker" });
});

test("counts bytes, not characters", async () => {
  // "é" is 2 bytes in UTF-8.
  const text = "é".repeat(4_000);
  await expect(send(testChannel, { text })).rejects.toThrow(/8000 bytes/);
});

test("takes a transaction, not the database", () => {
  // Never called: the type check is the test. Outside a transaction, the notification would go
  // out even when the change it announces rolls back.
  // @ts-expect-error: a Db is not a transaction.
  const outside = () => notify(t!.db, testChannel, { text: "x" });
  expect(outside).toBeTypeOf("function");
});

test("accepts a channel name of 63 bytes, the longest PostgreSQL keeps", () => {
  expect(defineChannel("a".repeat(63), z.object({})).name).toHaveLength(63);
});

test.each([
  "",
  "Worker_heartbeat",
  "1channel",
  "worker-heartbeat",
  'a"; drop table x; --',
  // PostgreSQL would truncate it, so LISTEN would use a different name than pg_notify.
  "a".repeat(64),
])("rejects the channel name %j", (name) => {
  expect(() => defineChannel(name, z.object({}))).toThrow(/channel name/i);
});
