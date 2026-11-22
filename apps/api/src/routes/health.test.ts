import { healthResponseSchema } from "@padvinder/contracts";
import { createDb, recordHeartbeat, workerHeartbeats } from "@padvinder/db";
import {
  createTestDatabase,
  startStallingProxy,
  type StallingProxy,
  type TestDatabase,
} from "@padvinder/db/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { buildApp } from "../app";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";

let t: TestDatabase | undefined;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  t = await createTestDatabase();
  app = await buildApp({ env: testEnv, db: t.db, notifications: createNoopNotificationHub() });
});
// Tests in this file share one clone and each needs an empty table.
beforeEach(async () => {
  await t!.db.delete(workerHeartbeats);
});
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

const unreachable = {
  reachable: false,
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

test("200 ok with a fresh heartbeat", async () => {
  await recordHeartbeat(t!.db);
  const res = await app!.inject("/api/health");
  expect(res.statusCode).toBe(200);
  const body = healthResponseSchema.parse(res.json());
  expect(body).toMatchObject({
    status: "ok",
    commit: "test-commit",
    database: { reachable: true },
  });
  expect(body.database.postgresVersion).toMatch(/^\d+\.\d+$/);
  expect(body.database.postgisVersion).toMatch(/^3\./);
  expect(body.database.latestMigration?.name).toMatch(/^\d{14}_\w+$/);
});

test("503 with reachable:false when the database is down, within 5 s", async () => {
  const down = createDb("postgres://padvinder:padvinder@127.0.0.1:1/none");
  try {
    const app2 = await buildApp({
      env: testEnv,
      db: down.db,
      notifications: createNoopNotificationHub(),
    });
    try {
      const started = Date.now();
      const res = await app2.inject("/api/health");
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
