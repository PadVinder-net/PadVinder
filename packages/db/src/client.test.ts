import { afterAll, beforeAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "./client";
import {
  createTestDatabase,
  startStallingProxy,
  type StallingProxy,
  type TestDatabase,
} from "./testing";

const pools: { end(): Promise<void> }[] = [];
let t: TestDatabase | undefined;
let proxy: StallingProxy | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  // Closing the proxy first fails the queries still waiting on it, so the pools can end.
  await proxy?.close();
  await Promise.all(pools.map((pool) => pool.end()));
  await t?.drop();
});

test("does not throw at creation when the server is unreachable", async () => {
  const { pool } = createDb("postgres://nobody:nothing@127.0.0.1:1/none");
  pools.push(pool);
  expect(pool.totalCount).toBe(0);
});

test("applies the default statement timeout and application name", async () => {
  const { db, pool } = createDb(t!.url);
  pools.push(pool);
  const result = await db.execute<{ t: string; a: string }>(
    sql`select current_setting('statement_timeout') as t, current_setting('application_name') as a`,
  );
  expect(result.rows[0]).toEqual({ t: "5s", a: "padvinder" });
});

test("reports an idle client error to onError and keeps working", async () => {
  const errors: Error[] = [];
  const { db, pool } = createDb(t!.url, { onError: (error) => errors.push(error) });
  pools.push(pool);
  const pid = (await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]!.pid;

  const admin = createDb(t!.url);
  pools.push(admin.pool);
  await admin.db.execute(sql`select pg_terminate_backend(${pid})`);

  await expect.poll(() => errors.length).toBeGreaterThan(0);
  const next = await db.execute<{ ok: number }>(sql`select 1 as ok`);
  expect(next.rows[0]?.ok).toBe(1);
});

test("a query on a hung connection fails shortly after the statement timeout", async () => {
  proxy = await startStallingProxy(t!.url);
  const { db, pool } = createDb(proxy.url, { statementTimeoutMs: 200 });
  pools.push(pool);
  // Open a connection while the proxy still forwards, then let the server go silent.
  await db.execute(sql`select 1`);
  proxy.stall();
  const started = Date.now();
  // Drizzle wraps the driver's error.
  await expect(db.execute(sql`select 1`)).rejects.toMatchObject({
    cause: { message: "Query read timeout" },
  });
  expect(Date.now() - started).toBeLessThan(2_000);
});

test("keeps TCP keepalive on and the client timeout off without a statement timeout", () => {
  const withTimeout = createDb("postgres://nobody:nothing@127.0.0.1:1/none");
  const withoutTimeout = createDb("postgres://nobody:nothing@127.0.0.1:1/none", {
    statementTimeoutMs: 0,
  });
  pools.push(withTimeout.pool, withoutTimeout.pool);
  expect(withTimeout.pool.options).toMatchObject({
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    query_timeout: 6_000,
  });
  expect(withoutTimeout.pool.options.query_timeout).toBeUndefined();
});
