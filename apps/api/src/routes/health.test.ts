import { healthResponseSchema } from "@padvinder/contracts";
import { createDb, recordHeartbeat, workerHeartbeats } from "@padvinder/db";
import { startStallingProxy, type StallingProxy, type TestDatabase } from "@padvinder/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer } from "@padvinder/mail";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { createCast, type Cast } from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";
import { testEnv } from "../test-env";

let ctx: TestApp | undefined;
let t: TestDatabase | undefined;
let app: FastifyInstance | undefined;
let cast: Cast;

beforeAll(async () => {
  ctx = await createTestApp();
  t = ctx.t;
  app = ctx.app;
  cast = await createCast(ctx);
});
// Tests in this file share one clone and each needs an empty table.
beforeEach(async () => {
  await t!.db.delete(workerHeartbeats);
});
afterAll(async () => {
  await ctx?.close();
});

const unreachable = {
  reachable: false,
  detailsHidden: true,
  postgresVersion: null,
  postgisVersion: null,
  latestMigration: null,
};

test("503 degraded without a heartbeat", async () => {
  const res = await app!.inject("/api/health");
  expect(res.statusCode).toBe(503);
  expect(res.json()).toMatchObject({
    status: "degraded",
    database: { reachable: true },
    worker: { lastHeartbeatAt: null },
  });
});

test("without a login the details are hidden but the status is there", async () => {
  await recordHeartbeat(t!.db);
  const res = await app!.inject("/api/health");
  expect(res.statusCode).toBe(200);
  const body = healthResponseSchema.parse(res.json());
  expect(body).toMatchObject({
    status: "ok",
    commit: "test-commit",
    database: {
      reachable: true,
      detailsHidden: true,
      postgresVersion: null,
      postgisVersion: null,
      latestMigration: null,
    },
  });
  expect(body.worker.lastHeartbeatAt).not.toBeNull();
});

test("a volunteer gets the same as nobody", async () => {
  await recordHeartbeat(t!.db);
  const res = await app!.inject({ url: "/api/health", headers: cast.members.volunteer.headers });
  expect(res.json().database).toEqual({
    reachable: true,
    detailsHidden: true,
    postgresVersion: null,
    postgisVersion: null,
    latestMigration: null,
  });
});

test("an organization admin and a coordinator do not get the details either", async () => {
  await recordHeartbeat(t!.db);
  for (const member of ["organizationAdmin", "coordinator"] as const) {
    const res = await app!.inject({ url: "/api/health", headers: cast.members[member].headers });
    expect(res.json().database.detailsHidden).toBe(true);
  }
});

test("a platform admin gets the details", async () => {
  await recordHeartbeat(t!.db);
  const res = await app!.inject({
    url: "/api/health",
    headers: cast.members.platformAdmin.headers,
  });
  expect(res.statusCode).toBe(200);
  const body = healthResponseSchema.parse(res.json());
  expect(body.database.detailsHidden).toBe(false);
  expect(body.database.postgresVersion).toMatch(/^\d+\.\d+$/);
  expect(body.database.postgisVersion).toMatch(/^3\./);
  expect(body.database.latestMigration?.name).toMatch(/^\d{14}_\w+$/);
});

test("an invalid session cookie counts as nobody", async () => {
  await recordHeartbeat(t!.db);
  const res = await app!.inject({ url: "/api/health", headers: { cookie: "x=y" } });
  expect(res.statusCode).toBe(200);
  expect(res.json().database.detailsHidden).toBe(true);
});

test("a slow session lookup counts as nobody, and the database is still reachable", async () => {
  await recordHeartbeat(t!.db);
  // Block reads of the sessions table, so loading the actor hangs while the database is fine.
  const locker = await t!.pool.connect();
  try {
    await locker.query("begin");
    await locker.query("lock table sessions in access exclusive mode");
    const started = Date.now();
    const res = await app!.inject({
      url: "/api/health",
      headers: cast.members.platformAdmin.headers,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(res.statusCode).toBe(200);
    expect(res.json().database).toMatchObject({ reachable: true, detailsHidden: true });
  } finally {
    await locker.query("rollback");
    locker.release();
  }
});

test("the health check does not renew a session; the next request that needs a login does", async () => {
  await recordHeartbeat(t!.db);
  const login = await loginAs(ctx!, "health-renew@example.test");
  // Older than Better Auth's `updateAge` (one day), so the session is due for renewal.
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const oldExpiry = new Date(old.getTime() + 180 * 24 * 60 * 60 * 1000);
  await t!.pool.query("update sessions set updated_at = $1, expires_at = $2 where user_id = $3", [
    old,
    oldExpiry,
    login.userId,
  ]);
  const expiry = async () =>
    (
      await t!.pool.query("select expires_at from sessions where user_id = $1", [login.userId])
    ).rows[0].expires_at.getTime();

  // Renewing here would extend the session in the database without a fresh cookie in the browser.
  const health = await app!.inject({ url: "/api/health", headers: login.headers });
  expect(health.headers["set-cookie"]).toBeUndefined();
  expect(await expiry()).toBe(oldExpiry.getTime());

  const me = await app!.inject({ url: "/api/me", headers: login.headers });
  expect(String(me.headers["set-cookie"])).toContain("padvinder.session_token=");
  expect(await expiry()).toBeGreaterThan(oldExpiry.getTime());
});

test("503 with reachable:false when the database is down, also with a session cookie", async () => {
  const down = createDb("postgres://padvinder:padvinder@127.0.0.1:1/none");
  try {
    const app2 = await buildApp({
      env: testEnv,
      db: down.db,
      notifications: createNoopNotificationHub(),
      mailer: createMemoryMailer(),
    });
    try {
      const started = Date.now();
      const res = await app2.inject({
        url: "/api/health",
        headers: cast.members.platformAdmin.headers,
      });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(res.statusCode).toBe(503);
      expect(res.json().database).toEqual(unreachable);
      expect(res.json().worker).toEqual({ lastHeartbeatAt: null });
    } finally {
      await app2.close();
    }
  } finally {
    await down.pool.end();
  }
});

test("503 with reachable:false when the database hangs, within 5 s", async () => {
  let proxy: StallingProxy | undefined;
  let hung: ReturnType<typeof createDb> | undefined;
  try {
    proxy = await startStallingProxy(t!.url);
    hung = createDb(proxy.url);
    const app2 = await buildApp({
      env: testEnv,
      db: hung.db,
      notifications: createNoopNotificationHub(),
      mailer: createMemoryMailer(),
    });
    try {
      // Open a pooled connection while the proxy still forwards, then let the server go silent.
      expect((await app2.inject("/api/health")).json().database.reachable).toBe(true);
      proxy.stall();
      const started = Date.now();
      const res = await app2.inject("/api/health");
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(res.statusCode).toBe(503);
      expect(res.json().database).toEqual(unreachable);
    } finally {
      await app2.close();
    }
  } finally {
    // Closing the proxy fails the queries still waiting on it, so the pool can end.
    await proxy?.close();
    await hung?.pool.end();
  }
});
