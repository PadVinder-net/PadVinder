import { liveEventsChannel, notify, recordHeartbeat } from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer } from "../mail/mailer";
import { startNotificationHub, type NotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import { loginAs, type TestApp } from "../testing/login";
import { openEvents } from "../test-open-events";

let t: TestDatabase | undefined;
let hub: NotificationHub | undefined;
let app: FastifyInstance | undefined;
let baseUrl = "";
let mailer: ReturnType<typeof createMemoryMailer>;
let cookie: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestDatabase();
  const logger = (await import("fastify")).default({ logger: false }).log;
  hub = await startNotificationHub({
    databaseUrl: t.url,
    channels: [liveEventsChannel],
    logger,
  });
  mailer = createMemoryMailer();
  app = await buildApp({ env: testEnv, db: t.db, notifications: hub, mailer });
  const ctx: TestApp = { app, mailer, t, close: async () => {} };
  cookie = (await loginAs(ctx, "events@example.test")).headers;
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await app?.close();
  await hub?.close();
  await t?.drop();
});

test("401 without a login, before the stream opens", async () => {
  const stream = await openEvents(baseUrl);
  expect(stream.status).toBe(401);
  expect(stream.headers.get("content-type")).not.toContain("text/event-stream");
  expect(JSON.parse(stream.received())).toMatchObject({ statusCode: 401, code: "not_logged_in" });
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(0);
});

test("an old session is renewed and the stream response sets a fresh cookie", async () => {
  const login = await loginAs({ app: app!, mailer, t: t! } as TestApp, "renew@example.test");
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await t!.pool.query("update sessions set updated_at = $1, expires_at = $2 where user_id = $3", [
    old,
    new Date(old.getTime() + 180 * 24 * 60 * 60 * 1000),
    login.userId,
  ]);
  const stream = await openEvents(baseUrl, login.headers);
  expect(stream.status).toBe(200);
  expect(stream.headers.get("set-cookie")).toContain("padvinder.session_token=");
  stream.close();
});

test("401 with a cookie that is not a session", async () => {
  const stream = await openEvents(baseUrl, { cookie: "padvinder.session_token=nonsense.value" });
  expect(stream.status).toBe(401);
});

test("a logged-in user receives the heartbeat", async () => {
  const stream = await openEvents(baseUrl, cookie);
  expect(stream.status).toBe(200);
  const beatAt = "2027-03-01T19:30:00.000Z";
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(1);
  await t!.db.transaction((tx) =>
    notify(tx, liveEventsChannel, { type: "worker-heartbeat", beatAt }),
  );
  await expect(stream.nextEvent()).resolves.toMatchObject({ event: "worker-heartbeat" });
  stream.close();
});

test("forwards a heartbeat as an SSE event", async () => {
  const stream = await openEvents(baseUrl, cookie);
  const at = await recordHeartbeat(t!.db);
  await expect(stream.nextEvent()).resolves.toEqual({
    event: "worker-heartbeat",
    data: { type: "worker-heartbeat", beatAt: at.toISOString() },
  });
  stream.close();
});

test("forwards any event on the channel under its type as the SSE event name", async () => {
  const stream = await openEvents(baseUrl, cookie);
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
  const stream = await openEvents(baseUrl, cookie);
  expect(stream.status).toBe(200);
  expect(stream.headers.get("content-type")).toContain("text/event-stream");
  expect(stream.headers.get("x-accel-buffering")).toBe("no");
  expect(stream.headers.get("cache-control")).toBe("no-cache, no-transform");
  await expect.poll(() => stream.received()).toContain("retry: 5000\n\n");
  stream.close();
});

test("unsubscribes when the client disconnects", async () => {
  const stream = await openEvents(baseUrl, cookie);
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
  const mailer2 = createMemoryMailer();
  const app2 = await buildApp({ env: testEnv, db: t2.db, notifications: hub2, mailer: mailer2 });
  const url = await app2.listen({ port: 0, host: "127.0.0.1" });
  const ctx2: TestApp = { app: app2, mailer: mailer2, t: t2, close: async () => {} };
  const login2 = await loginAs(ctx2, "events2@example.test");
  const stream = await openEvents(url, login2.headers);
  await expect.poll(() => hub2.listenerCount(liveEventsChannel)).toBe(1);
  const started = Date.now();
  await app2.close();
  expect(Date.now() - started).toBeLessThan(2_000);
  stream.close();
  await hub2.close();
  await t2.drop();
});
