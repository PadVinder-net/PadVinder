import { liveEventsChannel, notify, recordHeartbeat } from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../app";
import { startNotificationHub, type NotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import { openEvents } from "../test-open-events";

let t: TestDatabase | undefined;
let hub: NotificationHub | undefined;
let app: FastifyInstance | undefined;
let baseUrl = "";

beforeAll(async () => {
  t = await createTestDatabase();
  const logger = (await import("fastify")).default({ logger: false }).log;
  hub = await startNotificationHub({
    databaseUrl: t.url,
    channels: [liveEventsChannel],
    logger,
  });
  app = await buildApp({ env: testEnv, db: t.db, notifications: hub });
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await app?.close();
  await hub?.close();
  await t?.drop();
});

test("forwards a heartbeat as an SSE event", async () => {
  const stream = await openEvents(baseUrl);
  const at = await recordHeartbeat(t!.db);
  await expect(stream.nextEvent()).resolves.toEqual({
    event: "worker-heartbeat",
    data: { type: "worker-heartbeat", beatAt: at.toISOString() },
  });
  stream.close();
});

test("forwards any event on the channel under its type as the SSE event name", async () => {
  const stream = await openEvents(baseUrl);
  const beatAt = "2027-03-01T19:30:00.000Z";
  await t!.db.transaction((tx) =>
    notify(tx, liveEventsChannel, { type: "worker-heartbeat", beatAt }),
  );
  await expect(stream.nextEvent()).resolves.toEqual({
    event: "worker-heartbeat",
    data: { type: "worker-heartbeat", beatAt },
  });
  stream.close();
});

test("sends no-buffering headers and an explicit retry", async () => {
  const stream = await openEvents(baseUrl);
  expect(stream.status).toBe(200);
  expect(stream.headers.get("content-type")).toContain("text/event-stream");
  expect(stream.headers.get("x-accel-buffering")).toBe("no");
  expect(stream.headers.get("cache-control")).toBe("no-cache, no-transform");
  await expect.poll(() => stream.received()).toContain("retry: 5000\n\n");
  stream.close();
});

test("unsubscribes when the client disconnects", async () => {
  const stream = await openEvents(baseUrl);
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(1);
  stream.close();
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(0);
});

test("is not part of the OpenAPI description", async () => {
  expect(JSON.stringify(app!.swagger())).not.toContain("/api/events");
});

test("app.close() ends open streams promptly", async () => {
  const t2 = await createTestDatabase();
  const hub2 = await startNotificationHub({
    databaseUrl: t2.url,
    channels: [liveEventsChannel],
    logger: app!.log,
  });
  const app2 = await buildApp({ env: testEnv, db: t2.db, notifications: hub2 });
  const url = await app2.listen({ port: 0, host: "127.0.0.1" });
  const stream = await openEvents(url);
  await expect.poll(() => hub2.listenerCount(liveEventsChannel)).toBe(1);
  const started = Date.now();
  await app2.close();
  expect(Date.now() - started).toBeLessThan(2_000);
  stream.close();
  await hub2.close();
  await t2.drop();
});
