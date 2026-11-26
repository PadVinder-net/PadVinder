import { createTestLogger } from "@padvinder/logging/testing";
import {
  grantCoordinator,
  grantPlatformAdmin,
  liveEventsChannel,
  notify,
  notifyAccessChanged,
  notifyMembershipRequestsChanged,
  recordHeartbeat,
  revokeCoordinator,
  sessions,
  users,
  workingGroupMemberships,
} from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer, createMemoryMailQueue } from "@padvinder/mail";
import { startNotificationHub, type NotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import { createCast, type Cast } from "../testing/cast";
import { loginAs, type TestApp } from "../testing/login";
import { stampSession } from "../testing/passkeys";
import { openEvents, type EventsClient } from "../test-open-events";

// Counts every load of the actor by the stream (a check or a reload), lets a test make it fail as
// a database failure would, and lets a test hold a load's result back.
const recheck = vi.hoisted(() => ({
  calls: 0,
  failing: false,
  intercept: undefined as ((load: Promise<unknown>) => Promise<unknown>) | undefined,
}));
vi.mock("../permissions/actor", async (importOriginal) => {
  const original = await importOriginal<typeof import("../permissions/actor")>();
  return {
    ...original,
    loadActor: async (...args: Parameters<typeof original.loadActor>) => {
      recheck.calls++;
      if (recheck.failing) throw new Error("connection terminated unexpectedly");
      const load = original.loadActor(...args);
      return recheck.intercept ? ((await recheck.intercept(load)) as Awaited<typeof load>) : load;
    },
  };
});

const RECHECK_MS = 200;
/** For the app whose streams never check on their own during a test: only events reload. */
const STEADY_RECHECK_MS = 3_600_000;

let t: TestDatabase | undefined;
let hub: NotificationHub | undefined;
let app: FastifyInstance | undefined;
let steadyApp: FastifyInstance | undefined;
let ctx: TestApp;
let baseUrl = "";
let steadyUrl = "";
let mailer: ReturnType<typeof createMemoryMailer>;
let cast: Cast;
let admin: Record<string, string> = {};
const log = createTestLogger("info");
let mark = 0;
const lines = () => log.text().split("\n").filter(Boolean).slice(mark);
const clearLog = () => {
  mark = log.text().split("\n").filter(Boolean).length;
};

beforeAll(async () => {
  t = await createTestDatabase();
  const logger = (await import("fastify")).default({ logger: false }).log;
  hub = await startNotificationHub({
    databaseUrl: t.url,
    channels: [liveEventsChannel],
    logger,
  });
  mailer = createMemoryMailer();
  const mailQueue = createMemoryMailQueue();
  app = await buildApp({
    env: testEnv,
    db: t.db,
    notifications: hub,
    mailer,
    queueMail: mailQueue.queueMail,
    sessionRecheckMs: RECHECK_MS,
    logger: log.logger,
  });
  ctx = { app, mailer, mailQueue, t, close: async () => {} };
  cast = await createCast(ctx);
  admin = cast.members.platformAdmin.headers;
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  // A second app on the same database and hub, so the sessions and events are the same.
  steadyApp = await buildApp({
    env: testEnv,
    db: t.db,
    notifications: hub,
    mailer,
    queueMail: mailQueue.queueMail,
    sessionRecheckMs: STEADY_RECHECK_MS,
    logger: log.logger,
  });
  steadyUrl = await steadyApp.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await steadyApp?.close();
  await app?.close();
  await hub?.close();
  await t?.drop();
});

// A closed stream lets go of its listener a moment later; the next test counts from zero.
afterEach(async () => {
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(0);
});

/** Opens a stream and waits until the hub has its listener, so no event is sent too early. */
async function openSubscribed(
  headers: Record<string, string>,
  url: string = baseUrl,
): Promise<EventsClient> {
  const before = hub!.listenerCount(liveEventsChannel);
  const stream = await openEvents(url, headers);
  expect(stream.status).toBe(200);
  await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(before + 1);
  return stream;
}

/** A user of their own, logged in, so a test can change their rights or end their session. */
async function newPlatformAdmin(email: string) {
  const login = await loginAs(ctx, email);
  await grantPlatformAdmin(t!.db, { email }, { kind: "system" });
  // Admin power needs a passkey in this session; the stream delivers admin events only then.
  await stampSession(ctx, login.headers.cookie!, new Date());
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
  const mailQueue2 = createMemoryMailQueue();
  const app2 = await buildApp({
    env: testEnv,
    db: t2.db,
    notifications: hub2,
    mailer: mailer2,
    queueMail: mailQueue2.queueMail,
  });
  const url = await app2.listen({ port: 0, host: "127.0.0.1" });
  const ctx2: TestApp = {
    app: app2,
    mailer: mailer2,
    mailQueue: mailQueue2,
    t: t2,
    close: async () => {},
  };
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
  clearLog();
  recheck.failing = true;
  try {
    // Two failed checks in a row, so the stream survives more than one.
    await expect.poll(() => recheck.calls - before, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => lines().join("")).toContain("Live events session check failed");
    const at = await recordHeartbeat(t!.db);
    await expect(stream.nextEvent()).resolves.toEqual({
      event: "worker-heartbeat",
      data: { type: "worker-heartbeat", beatAt: at.toISOString() },
    });
  } finally {
    recheck.failing = false;
  }
  const warning = lines().find((line) => line.includes("Live events session check failed"))!;
  expect(JSON.parse(warning)).toMatchObject({ level: "warn" });
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

// The tests below run on the steady app, whose streams do not check their session on their own
// during a test: whatever changes there comes from an event.

/** Opens a steady stream for each named member of the cast. */
async function openForCast<K extends keyof Cast["members"]>(
  names: readonly K[],
): Promise<Record<K, EventsClient>> {
  const streams = {} as Record<K, EventsClient>;
  for (const name of names) {
    streams[name] = await openSubscribed(cast.members[name].headers, steadyUrl);
  }
  return streams;
}

function closeAll(streams: Record<string, EventsClient>) {
  for (const stream of Object.values(streams)) stream.close();
}

function sendRequestsChanged(group: { workingGroupId: string; organizationId: string }) {
  return t!.db.transaction((tx) => notifyMembershipRequestsChanged(tx, group));
}

function requestsChanged(group: { workingGroupId: string; organizationId: string }) {
  const data = {
    type: "membership-requests-changed",
    workingGroupId: group.workingGroupId,
    organizationId: group.organizationId,
  };
  return { event: data.type, data };
}

/** No stream gets another event; call it after a witness stream has received the last one. */
async function expectNothing(streams: EventsClient[]) {
  // The hub hands an event to every stream at once, so once the witness has it, these have had
  // their chance too; the 500 ms only cover the way through the socket.
  for (const stream of streams) {
    await expect(stream.nextEvent(500)).rejects.toThrow("No event within 500 ms");
  }
}

test("a coordinator receives membership-requests-changed for their group; the volunteer and the outsiders do not", async () => {
  const streams = await openForCast([
    "coordinator",
    "volunteer",
    "volunteerOtherGroup",
    "coordinatorOtherOrganization",
    "organizationAdminOtherOrganization",
    "applicant",
  ] as const);
  // First an event for another group of the same organization, which the coordinator must skip.
  await sendRequestsChanged(cast.otherGroup);
  await sendRequestsChanged(cast.workingGroup);
  await expect(streams.coordinator.nextEvent()).resolves.toEqual(
    requestsChanged(cast.workingGroup),
  );
  await expectNothing([
    streams.volunteer,
    streams.volunteerOtherGroup,
    streams.coordinatorOtherOrganization,
    streams.organizationAdminOtherOrganization,
    streams.applicant,
  ]);
  closeAll(streams);
});

test("an organization admin receives it too, for every group of the organization", async () => {
  const streams = await openForCast(["organizationAdmin", "platformAdmin"] as const);
  await sendRequestsChanged(cast.workingGroup);
  await sendRequestsChanged(cast.otherGroup);
  await sendRequestsChanged(cast.foreignGroup);
  for (const group of [cast.workingGroup, cast.otherGroup]) {
    await expect(streams.organizationAdmin.nextEvent()).resolves.toEqual(requestsChanged(group));
  }
  // The platform admin receives all three; the last one is the witness for the other organization.
  for (const group of [cast.workingGroup, cast.otherGroup, cast.foreignGroup]) {
    await expect(streams.platformAdmin.nextEvent()).resolves.toEqual(requestsChanged(group));
  }
  await expectNothing([streams.organizationAdmin]);
  closeAll(streams);
});

test("access-changed reaches only that user, not even a platform admin", async () => {
  const streams = await openForCast([
    "applicant",
    "volunteer",
    "coordinator",
    "platformAdmin",
  ] as const);
  const userId = cast.members.applicant.userId;
  await t!.db.transaction((tx) => notifyAccessChanged(tx, userId));
  await expect(streams.applicant.nextEvent()).resolves.toEqual({
    event: "access-changed",
    data: { type: "access-changed", userId },
  });
  await expectNothing([streams.volunteer, streams.coordinator, streams.platformAdmin]);
  closeAll(streams);
});

test("after access-changed the stream uses the new rights", async () => {
  const applicant = cast.members.applicant;
  const stream = await openSubscribed(applicant.headers, steadyUrl);
  try {
    // Not yet a coordinator: this one does not arrive.
    await sendRequestsChanged(cast.workingGroup);
    await grantCoordinator(
      t!.db,
      { email: applicant.email, workingGroupId: cast.workingGroup.workingGroupId },
      { kind: "system" },
    );
    await expect(stream.nextEvent()).resolves.toMatchObject({ event: "access-changed" });
    await sendRequestsChanged(cast.workingGroup);
    await expect(stream.nextEvent()).resolves.toEqual(requestsChanged(cast.workingGroup));
  } finally {
    stream.close();
    // The applicant stays an applicant for the other tests.
    await t!.db
      .delete(workingGroupMemberships)
      .where(eq(workingGroupMemberships.userId, applicant.userId));
  }
});

test("after access-changed the stream loses the rights that were revoked", async () => {
  const email = "events-revoked@example.test";
  const login = await loginAs(ctx, email);
  const group = { email, workingGroupId: cast.workingGroup.workingGroupId };
  await grantCoordinator(t!.db, group, { kind: "system" });
  const stream = await openSubscribed(login.headers, steadyUrl);
  const witness = await openSubscribed(cast.members.coordinator.headers, steadyUrl);
  await revokeCoordinator(t!.db, group, { kind: "system" });
  await expect(stream.nextEvent()).resolves.toMatchObject({ event: "access-changed" });
  await sendRequestsChanged(cast.workingGroup);
  await expect(witness.nextEvent()).resolves.toEqual(requestsChanged(cast.workingGroup));
  await expectNothing([stream]);
  stream.close();
  witness.close();
});

test("a stream ends when its session no longer exists", async () => {
  const login = await loginAs(ctx, "events-session-gone@example.test");
  const stream = await openSubscribed(login.headers, steadyUrl);
  await t!.db.delete(sessions).where(eq(sessions.userId, login.userId));
  await t!.db.transaction((tx) => notifyAccessChanged(tx, login.userId));
  await expect(stream.nextEvent()).rejects.toThrow("Stream ended before the next event");
  expect(stream.received()).not.toContain("event:");
  stream.close();
});

test("a stream ends when its user no longer exists", async () => {
  const login = await loginAs(ctx, "events-user-gone@example.test");
  const stream = await openSubscribed(login.headers, steadyUrl);
  await t!.db.delete(users).where(eq(users.id, login.userId));
  await t!.db.transaction((tx) => notifyAccessChanged(tx, login.userId));
  await expect(stream.nextEvent()).rejects.toThrow("Stream ended before the next event");
  expect(stream.received()).not.toContain("event:");
  stream.close();
});

test("a database failure while reloading keeps the stream and the old actor, and still delivers", async () => {
  const email = "events-reload-failure@example.test";
  const login = await newPlatformAdmin(email);
  const stream = await openSubscribed(login.headers, steadyUrl);
  const before = recheck.calls;
  clearLog();
  recheck.failing = true;
  try {
    await t!.db.transaction((tx) => notifyAccessChanged(tx, login.userId));
    await expect(stream.nextEvent()).resolves.toEqual({
      event: "access-changed",
      data: { type: "access-changed", userId: login.userId },
    });
    expect(recheck.calls - before).toBe(1);
  } finally {
    recheck.failing = false;
  }
  expect(lines().join("")).toContain("Live events session check failed");
  // Still a platform admin on this stream.
  const at = await recordHeartbeat(t!.db);
  await expect(stream.nextEvent()).resolves.toEqual({
    event: "worker-heartbeat",
    data: { type: "worker-heartbeat", beatAt: at.toISOString() },
  });
  stream.close();
});

test("a check that started before access-changed does not overwrite the newer actor", async () => {
  // On the app that checks every RECHECK_MS.
  const email = "events-stale-check@example.test";
  const login = await loginAs(ctx, email);
  const stream = await openSubscribed(login.headers);
  const parked = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  let call = 0;
  recheck.intercept = async (load) => {
    const index = call++;
    const result = await load;
    // The first load is a periodic check: it read the actor from before the grant and is held.
    if (index === 0) {
      parked.resolve();
      await release.promise;
    }
    // The second is the reload for access-changed. Every later check waits for the end of the
    // test, so none of them can repair a wrong actor in the meantime.
    if (index >= 2) await done.promise;
    return result;
  };
  try {
    await parked.promise;
    await grantPlatformAdmin(t!.db, { email }, { kind: "system" });
    // Admin events need a passkey in this session.
    await stampSession(ctx, login.headers.cookie!, new Date());
    await expect(stream.nextEvent()).resolves.toMatchObject({ event: "access-changed" });
    expect(call).toBe(2);
    release.resolve();
    // The next check starts only once the held one is finished.
    await expect.poll(() => call, { timeout: 10_000 }).toBe(3);
    const at = await recordHeartbeat(t!.db);
    await expect(stream.nextEvent()).resolves.toEqual({
      event: "worker-heartbeat",
      data: { type: "worker-heartbeat", beatAt: at.toISOString() },
    });
  } finally {
    recheck.intercept = undefined;
    release.resolve();
    done.resolve();
    stream.close();
  }
}, 20_000);

// Admin power needs a passkey: the stream delivers by the roles a session has now.

test("an unconfirmed organization admin does not receive membership-requests-changed for a group they do not coordinate", async () => {
  const streams = await openForCast(["organizationAdminUnconfirmed", "platformAdmin"] as const);
  await sendRequestsChanged(cast.otherGroup);
  await expect(streams.platformAdmin.nextEvent()).resolves.toEqual(
    requestsChanged(cast.otherGroup),
  );
  await expectNothing([streams.organizationAdminUnconfirmed]);
  closeAll(streams);
});

test("the same admin receives it for the group they coordinate", async () => {
  const admin = cast.members.organizationAdminUnconfirmed;
  await grantCoordinator(
    t!.db,
    { email: admin.email, workingGroupId: cast.otherGroup.workingGroupId },
    { kind: "system" },
  );
  const streams = await openForCast(["organizationAdminUnconfirmed"] as const);
  try {
    await sendRequestsChanged(cast.workingGroup);
    await sendRequestsChanged(cast.otherGroup);
    await expect(streams.organizationAdminUnconfirmed.nextEvent()).resolves.toEqual(
      requestsChanged(cast.otherGroup),
    );
    await expectNothing([streams.organizationAdminUnconfirmed]);
  } finally {
    closeAll(streams);
    await t!.db
      .delete(workingGroupMemberships)
      .where(
        and(
          eq(workingGroupMemberships.userId, admin.userId),
          eq(workingGroupMemberships.workingGroupId, cast.otherGroup.workingGroupId),
        ),
      );
  }
});

test("a confirmed organization admin receives it for every group of the organization", async () => {
  const streams = await openForCast(["organizationAdmin"] as const);
  await sendRequestsChanged(cast.workingGroup);
  await sendRequestsChanged(cast.otherGroup);
  for (const group of [cast.workingGroup, cast.otherGroup]) {
    await expect(streams.organizationAdmin.nextEvent()).resolves.toEqual(requestsChanged(group));
  }
  closeAll(streams);
});

test("an unconfirmed platform admin receives no worker-heartbeat and no event of another organization", async () => {
  const streams = await openForCast(["platformAdminUnconfirmed", "platformAdmin"] as const);
  await t!.db.transaction((tx) =>
    notify(tx, liveEventsChannel, { type: "worker-heartbeat", beatAt: "2027-03-01T19:30:00.000Z" }),
  );
  await sendRequestsChanged(cast.foreignGroup);
  await expect(streams.platformAdmin.nextEvent()).resolves.toMatchObject({
    event: "worker-heartbeat",
  });
  await expect(streams.platformAdmin.nextEvent()).resolves.toEqual(
    requestsChanged(cast.foreignGroup),
  );
  await expectNothing([streams.platformAdminUnconfirmed]);
  closeAll(streams);
});

test("a confirmation that runs out while the stream is open stops the admin events without a reconnect", async () => {
  const admin = cast.members.organizationAdminUnconfirmed;
  // Confirmed for 4 more seconds; the stream's own check is an hour away.
  const window = 24 * 60 * 60 * 1000;
  const stamp = new Date(Date.now() - window + 4_000);
  await stampSession(ctx, admin.headers.cookie!, stamp);
  const streams = await openForCast(["organizationAdminUnconfirmed"] as const);
  try {
    await sendRequestsChanged(cast.otherGroup);
    await expect(streams.organizationAdminUnconfirmed.nextEvent()).resolves.toEqual(
      requestsChanged(cast.otherGroup),
    );
    // Wait until the window has passed, computed from the stamp.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, stamp.getTime() + window + 200 - Date.now())),
    );
    await sendRequestsChanged(cast.otherGroup);
    await expectNothing([streams.organizationAdminUnconfirmed]);
  } finally {
    closeAll(streams);
    await stampSession(ctx, admin.headers.cookie!, null);
  }
});

test("events for the user (access-changed) still reach an unconfirmed admin", async () => {
  const streams = await openForCast(["organizationAdminUnconfirmed"] as const);
  const userId = cast.members.organizationAdminUnconfirmed.userId;
  await t!.db.transaction((tx) => notifyAccessChanged(tx, userId));
  await expect(streams.organizationAdminUnconfirmed.nextEvent()).resolves.toEqual({
    event: "access-changed",
    data: { type: "access-changed", userId },
  });
  closeAll(streams);
});
