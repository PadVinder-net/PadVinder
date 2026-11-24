import { grantPlatformAdmin, liveEventsChannel, notify, recordHeartbeat } from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer } from "../mail/mailer";
import { startNotificationHub, type NotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import { createCast, type Cast } from "../testing/cast";
import { loginAs, type TestApp } from "../testing/login";
import { openEvents, type EventsClient } from "../test-open-events";

// Counts every re-check, and lets a test make it fail as a database failure would.
const recheck = vi.hoisted(() => ({ calls: 0, failing: false }));
vi.mock("../permissions/actor", async (importOriginal) => {
  const original = await importOriginal<typeof import("../permissions/actor")>();
  return {
    ...original,
    loadActor: async (...args: Parameters<typeof original.loadActor>) => {
      recheck.calls++;
      if (recheck.failing) throw new Error("connection terminated unexpectedly");
      return original.loadActor(...args);
    },
  };
});

const RECHECK_MS = 200;

let t: TestDatabase | undefined;
let hub: NotificationHub | undefined;
let app: FastifyInstance | undefined;
let ctx: TestApp;
let baseUrl = "";
let mailer: ReturnType<typeof createMemoryMailer>;
let cast: Cast;
let admin: Record<string, string> = {};
const lines: string[] = [];

beforeAll(async () => {
  t = await createTestDatabase();
  const logger = (await import("fastify")).default({ logger: false }).log;
  hub = await startNotificationHub({
    databaseUrl: t.url,
    channels: [liveEventsChannel],
    logger,
  });
  mailer = createMemoryMailer();
  app = await buildApp({
    env: testEnv,
    db: t.db,
    notifications: hub,
    mailer,
    sessionRecheckMs: RECHECK_MS,
    logger: true,
    logStream: { write: (line) => lines.push(line) },
  });
  ctx = { app, mailer, t, close: async () => {} };
  cast = await createCast(ctx);
  admin = cast.members.platformAdmin.headers;
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await app?.close();
  await hub?.close();
  await t?.drop();
});

// A closed stream lets go of its listener a moment later; the next test counts from zero.
afterEach(async () => {
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(0);
});

/** Opens a stream and waits until the hub has its listener, so no event is sent too early. */
async function openSubscribed(headers: Record<string, string>): Promise<EventsClient> {
  const before = hub!.listenerCount(liveEventsChannel);
  const stream = await openEvents(baseUrl, headers);
  expect(stream.status).toBe(200);
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(before + 1);
  return stream;
}

/** A user of their own, logged in, so a test can change their rights or end their session. */
async function newPlatformAdmin(email: string) {
  const login = await loginAs(ctx, email);
  await grantPlatformAdmin(t!.db, { email }, { kind: "system" });
  return login;
}

test("401 without a login, before the stream opens", async () => {
  const stream = await openEvents(baseUrl);
  expect(stream.status).toBe(401);
  expect(stream.headers.get("content-type")).not.toContain("text/event-stream");
  expect(JSON.parse(stream.received())).toMatchObject({ statusCode: 401, code: "not_logged_in" });
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(0);
});

test("an old session is renewed and the stream response sets a fresh cookie", async () => {
  const login = await loginAs(ctx, "renew@example.test");
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

test("a platform admin receives the heartbeat", async () => {
  const stream = await openEvents(baseUrl, admin);
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
  const stream = await openEvents(baseUrl, admin);
  const at = await recordHeartbeat(t!.db);
  await expect(stream.nextEvent()).resolves.toEqual({
    event: "worker-heartbeat",
    data: { type: "worker-heartbeat", beatAt: at.toISOString() },
  });
  stream.close();
});

test("forwards any event on the channel under its type as the SSE event name", async () => {
  const stream = await openEvents(baseUrl, admin);
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
  const stream = await openEvents(baseUrl, admin);
  expect(stream.status).toBe(200);
  expect(stream.headers.get("content-type")).toContain("text/event-stream");
  expect(stream.headers.get("x-accel-buffering")).toBe("no");
  expect(stream.headers.get("cache-control")).toBe("no-cache, no-transform");
  await expect.poll(() => stream.received()).toContain("retry: 5000\n\n");
  stream.close();
});

test("unsubscribes when the client disconnects", async () => {
  const stream = await openEvents(baseUrl, admin);
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

test("a volunteer does not receive the worker heartbeat", async () => {
  const volunteer = await openSubscribed(cast.members.volunteer.headers);
  const witness = await openSubscribed(admin);
  await recordHeartbeat(t!.db);
  // The hub hands the event to both streams at once, so once the witness has it, the volunteer's
  // stream has had its chance too; the 500 ms only cover the way through the socket.
  await expect(witness.nextEvent()).resolves.toMatchObject({ event: "worker-heartbeat" });
  await expect(volunteer.nextEvent(500)).rejects.toThrow("No event within 500 ms");
  expect(volunteer.received()).not.toContain("event:");
  volunteer.close();
  witness.close();
});

test("a platform admin does", async () => {
  const stream = await openSubscribed(admin);
  const at = await recordHeartbeat(t!.db);
  await expect(stream.nextEvent()).resolves.toEqual({
    event: "worker-heartbeat",
    data: { type: "worker-heartbeat", beatAt: at.toISOString() },
  });
  stream.close();
});

test("after logging out the stream gets nothing and ends at the next check", async () => {
  const login = await newPlatformAdmin("events-logout@example.test");
  const stream = await openSubscribed(login.headers);
  const signedOut = await app!.inject({
    method: "POST",
    url: "/api/auth/sign-out",
    headers: { ...login.headers, origin: testEnv.PUBLIC_ORIGIN },
  });
  expect(signedOut.statusCode).toBe(200);
  await expect(stream.nextEvent(5_000)).rejects.toThrow("Stream ended before the next event");
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(0);
  await recordHeartbeat(t!.db);
  expect(stream.received()).not.toContain("event:");
  stream.close();
}, 20_000);

test("the next check replaces the actor with the fresh one", async () => {
  const email = "events-promoted@example.test";
  const login = await loginAs(ctx, email);
  const stream = await openSubscribed(login.headers);
  await grantPlatformAdmin(t!.db, { email }, { kind: "system" });
  // Beat until one arrives: the first ones may come before the next check.
  await expect
    .poll(
      async () => {
        await recordHeartbeat(t!.db);
        return stream.nextEvent(RECHECK_MS).then(
          () => true,
          () => false,
        );
      },
      { timeout: 10_000, interval: 0 },
    )
    .toBe(true);
  stream.close();
}, 20_000);

test("a database failure during a check keeps the stream and the old actor, and warns", async () => {
  const email = "events-db-failure@example.test";
  const login = await newPlatformAdmin(email);
  const stream = await openSubscribed(login.headers);
  const before = recheck.calls;
  lines.length = 0;
  recheck.failing = true;
  try {
    // Two failed checks in a row, so the stream survives more than one.
    await expect.poll(() => recheck.calls - before, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => lines.join("")).toContain("Live events session check failed");
    const at = await recordHeartbeat(t!.db);
    await expect(stream.nextEvent()).resolves.toEqual({
      event: "worker-heartbeat",
      data: { type: "worker-heartbeat", beatAt: at.toISOString() },
    });
  } finally {
    recheck.failing = false;
  }
  const warning = lines.find((line) => line.includes("Live events session check failed"))!;
  expect(JSON.parse(warning)).toMatchObject({ level: 40 });
  expect(warning).not.toContain(email);
  expect(warning).not.toContain(login.userId);
  stream.close();
}, 20_000);

test("stops checking once the client disconnects", async () => {
  const stream = await openSubscribed(admin);
  const before = recheck.calls;
  await expect.poll(() => recheck.calls, { timeout: 10_000 }).toBeGreaterThan(before);
  stream.close();
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(0);
  const after = recheck.calls;
  // Three intervals: a timer that was left behind would have run by now.
  await new Promise((resolve) => setTimeout(resolve, 3 * RECHECK_MS));
  expect(recheck.calls).toBe(after);
}, 20_000);
