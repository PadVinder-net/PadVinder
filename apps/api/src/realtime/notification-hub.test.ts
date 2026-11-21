import type { LiveEvent } from "@padvinder/contracts";
import { defineChannel, liveEventsChannel, recordHeartbeat } from "@padvinder/db";
import {
  createTestDatabase,
  startStallingProxy,
  type StallingProxy,
  type TestDatabase,
} from "@padvinder/db/testing";
import { connect, createServer, type Socket } from "node:net";
import Fastify from "fastify";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { startNotificationHub, type NotificationHub } from "./notification-hub";

let t: TestDatabase | undefined;
// A real Fastify logger instance that logs nothing.
const logger = Fastify({ logger: false }).log;

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

const terminateListener = () =>
  t!.pool.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'padvinder-notifications' and datname = current_database()",
  );

test("delivers notifications to subscribers until they unsubscribe", async () => {
  const hub = await startNotificationHub({
    databaseUrl: t!.url,
    channels: [liveEventsChannel],
    logger,
  });
  const received: LiveEvent[] = [];
  const unsubscribe = hub.subscribe(liveEventsChannel, (p) => received.push(p));
  expect(hub.listenerCount(liveEventsChannel)).toBe(1);
  const at = await recordHeartbeat(t!.db);
  await expect.poll(() => received.length).toBe(1);
  expect(received).toEqual([{ type: "worker-heartbeat", beatAt: at.toISOString() }]);
  unsubscribe();
  expect(hub.listenerCount(liveEventsChannel)).toBe(0);
  await hub.close();
});

test("a throwing listener does not stop the others or the hub", async () => {
  const hub = await startNotificationHub({
    databaseUrl: t!.url,
    channels: [liveEventsChannel],
    logger,
  });
  const received: LiveEvent[] = [];
  hub.subscribe(liveEventsChannel, () => {
    throw new Error("boom");
  });
  hub.subscribe(liveEventsChannel, (p) => received.push(p));
  await recordHeartbeat(t!.db);
  await recordHeartbeat(t!.db);
  await expect.poll(() => received.length).toBe(2);
  await hub.close();
});

test("parses each notification once: an invalid payload warns once and reaches no subscriber", async () => {
  const log = Fastify({ logger: false }).log;
  const warn = vi.spyOn(log, "warn");
  const hub = await startNotificationHub({
    databaseUrl: t!.url,
    channels: [liveEventsChannel],
    logger: log,
  });
  try {
    const received: LiveEvent[][] = [[], [], []];
    for (const events of received) hub.subscribe(liveEventsChannel, (e) => events.push(e));
    await t!.pool.query("select pg_notify($1, $2)", [liveEventsChannel.name, '{"nope":1}']);
    const at = await recordHeartbeat(t!.db);
    // Notifications arrive in order, so once the valid one is in, the invalid one was handled.
    await expect.poll(() => received.every((events) => events.length === 1)).toBe(true);
    for (const events of received)
      expect(events).toEqual([{ type: "worker-heartbeat", beatAt: at.toISOString() }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), channel: "live_events" }),
      "Dropped an invalid notification",
    );
  } finally {
    await hub.close();
  }
});

test("subscribe rejects a channel the hub does not listen on", async () => {
  const hub = await startNotificationHub({
    databaseUrl: t!.url,
    channels: [liveEventsChannel],
    logger,
  });
  try {
    const other = defineChannel("other_channel", z.object({}));
    expect(() => hub.subscribe(other, () => {})).toThrow("other_channel");
  } finally {
    await hub.close();
  }
});

test("reconnects after the listener is terminated", async () => {
  const hub = await startNotificationHub({
    databaseUrl: t!.url,
    channels: [liveEventsChannel],
    logger,
    reconnectDelayMs: 100,
  });
  const received: LiveEvent[] = [];
  hub.subscribe(liveEventsChannel, (p) => received.push(p));
  await terminateListener();
  await expect
    .poll(
      async () => {
        await recordHeartbeat(t!.db);
        return received.length;
      },
      { timeout: 10_000, interval: 300 },
    )
    .toBeGreaterThan(0);
  await hub.close();
});

test("close is idempotent and cancels a pending reconnect", async () => {
  const reconnectDelayMs = 500;
  const hub = await startNotificationHub({
    databaseUrl: t!.url,
    channels: [liveEventsChannel],
    logger,
    reconnectDelayMs,
  });
  const count = async () =>
    (
      await t!.pool.query(
        "select count(*)::int as n from pg_stat_activity where application_name = 'padvinder-notifications' and datname = current_database()",
      )
    ).rows[0].n as number;
  expect(await count()).toBe(1);
  // The connection drops, so a reconnect is now pending.
  await terminateListener();
  await expect.poll(count, { interval: 20 }).toBe(0);
  await hub.close();
  await hub.close();
  // Several reconnect delays: a pending reconnect that was not cancelled would have fired.
  await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs * 3));
  expect(await count()).toBe(0);
});

/** A port where nothing listens (yet). */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("starts while the database is down, warns, and keeps retrying until close", async () => {
  const lines: string[] = [];
  const recording = Fastify({
    logger: { level: "warn", stream: { write: (line: string) => lines.push(line) } },
  }).log;
  const hub = await startNotificationHub({
    databaseUrl: "postgres://padvinder:padvinder@127.0.0.1:1/none",
    channels: [liveEventsChannel],
    logger: recording,
    reconnectDelayMs: 20,
  });
  expect(lines[0]).toContain("Notification listener could not connect");
  await expect.poll(() => lines.length).toBeGreaterThan(2);
  await hub.close();
  const attempts = lines.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(lines.length).toBe(attempts);
});

test("connects and delivers once a database that was down comes up", async () => {
  // The database "comes up" when a proxy to it starts listening on this port.
  const port = await freePort();
  const target = new URL(t!.url);
  const url = new URL(t!.url);
  url.hostname = "127.0.0.1";
  url.port = String(port);
  const hub = await startNotificationHub({
    databaseUrl: url.toString(),
    channels: [liveEventsChannel],
    logger,
    reconnectDelayMs: 50,
  });
  const sockets = new Set<Socket>();
  const proxy = createServer((client) => {
    const upstream = connect(Number(target.port), target.hostname);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("error", () => {});
    }
    client.pipe(upstream).pipe(client);
  });
  try {
    await new Promise<void>((resolve) => proxy.listen(port, "127.0.0.1", resolve));
    const received: LiveEvent[] = [];
    hub.subscribe(liveEventsChannel, (p) => received.push(p));
    await expect
      .poll(
        async () => {
          await recordHeartbeat(t!.db);
          return received.length;
        },
        { timeout: 5_000, interval: 100 },
      )
      .toBeGreaterThan(0);
  } finally {
    await hub.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
  }
});

test("a database that accepts connections but never answers does not block the start", async () => {
  let proxy: StallingProxy | undefined;
  const log = Fastify({ logger: false }).log;
  const warn = vi.spyOn(log, "warn");
  try {
    proxy = await startStallingProxy(t!.url);
    proxy.stall();
    const started = Date.now();
    const hub = await startNotificationHub({
      databaseUrl: proxy.url,
      channels: [liveEventsChannel],
      logger: log,
      reconnectDelayMs: 50,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Notification listener could not connect, retrying",
    );
    // The reconnect loop keeps trying: a second attempt fails the same way.
    await expect
      .poll(() => warn.mock.calls.some(([, message]) => message?.includes("could not reconnect")), {
        timeout: 5_000,
      })
      .toBe(true);
    // Close while another attempt is in flight.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const closing = Date.now();
    await hub.close();
    expect(Date.now() - closing).toBeLessThan(1_000);
  } finally {
    await proxy?.close();
  }
}, 15_000);

/** The JSON log lines a test logger wrote, from `level` up. */
function recordingLogger(level: "info" | "warn") {
  const lines: { msg: string; retryInMs?: number }[] = [];
  const log = Fastify({
    logger: { level, stream: { write: (line: string) => lines.push(JSON.parse(line)) } },
  }).log;
  return { log, lines, messages: () => lines.map((line) => line.msg) };
}

test("the liveness check detects a stalled connection and the hub reconnects", async () => {
  const livenessCheckIntervalMs = 200;
  const livenessCheckTimeoutMs = 200;
  const proxy = await startStallingProxy(t!.url);
  const { log, messages } = recordingLogger("warn");
  const hub = await startNotificationHub({
    databaseUrl: proxy.url,
    channels: [liveEventsChannel],
    logger: log,
    reconnectDelayMs: 50,
    livenessCheckIntervalMs,
    livenessCheckTimeoutMs,
  });
  try {
    const received: LiveEvent[] = [];
    hub.subscribe(liveEventsChannel, (e) => received.push(e));
    await recordHeartbeat(t!.db);
    await expect.poll(() => received.length).toBe(1);

    // Connected and listening, then no byte arrives anymore, without FIN or RST.
    proxy.stall();
    await expect
      .poll(() => messages(), { timeout: livenessCheckIntervalMs + livenessCheckTimeoutMs + 500 })
      .toContain("Notification listener connection lost");

    proxy.resume();
    await expect
      .poll(
        async () => {
          await recordHeartbeat(t!.db);
          return received.length;
        },
        { timeout: 5_000, interval: 100 },
      )
      .toBeGreaterThan(1);
  } finally {
    await hub.close();
    await proxy.close();
  }
});

test("a healthy connection survives its liveness checks", async () => {
  const livenessCheckIntervalMs = 50;
  const livenessCheckTimeoutMs = 50;
  const { log, messages } = recordingLogger("warn");
  const listenerBackends = async () =>
    (
      await t!.pool.query<{ pid: number; query: string }>(
        "select pid, query from pg_stat_activity where application_name = 'padvinder-notifications' and datname = current_database()",
      )
    ).rows;
  const hub = await startNotificationHub({
    databaseUrl: t!.url,
    channels: [liveEventsChannel],
    logger: log,
    reconnectDelayMs: 10,
    livenessCheckIntervalMs,
    livenessCheckTimeoutMs,
  });
  try {
    const [before] = await listenerBackends();
    // Three liveness checks, each with time for its answer timeout to fire if it were left running.
    await new Promise((resolve) =>
      setTimeout(resolve, 3 * (livenessCheckIntervalMs + livenessCheckTimeoutMs)),
    );
    expect(messages()).not.toContain("Notification listener connection lost");
    // Still the same single connection, and the liveness check did run on it.
    const after = await listenerBackends();
    expect(after).toEqual([{ pid: before!.pid, query: "select 1" }]);
  } finally {
    await hub.close();
  }
});

test("reconnect delays double up to the maximum", async () => {
  const { log, lines } = recordingLogger("warn");
  const hub = await startNotificationHub({
    databaseUrl: "postgres://padvinder:padvinder@127.0.0.1:1/none",
    channels: [liveEventsChannel],
    logger: log,
    reconnectDelayMs: 10,
    maxReconnectDelayMs: 80,
  });
  try {
    await expect.poll(() => lines.length).toBeGreaterThanOrEqual(6);
  } finally {
    await hub.close();
  }
  expect(lines.slice(0, 6).map((line) => line.retryInMs)).toEqual([10, 20, 40, 80, 80, 80]);
});

test("the delay starts over after a successful reconnect", async () => {
  const reconnectDelayMs = 20;
  const { log, lines, messages } = recordingLogger("info");
  const hub = await startNotificationHub({
    databaseUrl: t!.url,
    channels: [liveEventsChannel],
    logger: log,
    reconnectDelayMs,
  });
  try {
    for (let drop = 1; drop <= 3; drop++) {
      await terminateListener();
      await expect
        .poll(() => messages().filter((m) => m === "Notification listener reconnected").length)
        .toBe(drop);
    }
    const lost = lines.filter((line) => line.msg === "Notification listener connection lost");
    expect(lost.map((line) => line.retryInMs)).toEqual([20, 20, 20]);
  } finally {
    await hub.close();
  }
});

test("close() leaves no timer behind", async () => {
  const livenessCheckIntervalMs = 1_000;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  let hub: NotificationHub | undefined;
  let down: NotificationHub | undefined;
  try {
    // Connected, with a liveness check query in flight.
    hub = await startNotificationHub({
      databaseUrl: t!.url,
      channels: [liveEventsChannel],
      logger,
      livenessCheckIntervalMs,
    });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(livenessCheckIntervalMs);
    expect(vi.getTimerCount()).toBe(1);
    await hub.close();
    expect(vi.getTimerCount()).toBe(0);

    // The database is down, with a reconnect pending.
    down = await startNotificationHub({
      databaseUrl: "postgres://padvinder:padvinder@127.0.0.1:1/none",
      channels: [liveEventsChannel],
      logger,
    });
    expect(vi.getTimerCount()).toBe(1);
    await down.close();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    // close() is idempotent; this only matters when an assertion above failed.
    await hub?.close();
    await down?.close();
    vi.useRealTimers();
  }
});
