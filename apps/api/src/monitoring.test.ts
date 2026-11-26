import type { AddressInfo } from "node:net";
import type { LiveEvent } from "@padvinder/contracts";
import { grantPlatformAdmin } from "@padvinder/db";
import { createLogger } from "@padvinder/logging";
import { createMemoryMailer } from "@padvinder/mail";
import {
  closeMonitoring,
  flushMonitoring,
  startServerMonitoring,
  withSpan,
} from "@padvinder/monitoring";
import { createTestTransport } from "@padvinder/monitoring/testing";
import * as Sentry from "@sentry/node";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sendInBackground } from "./mail/send-in-background";
import { loadActor } from "./permissions/actor";
import type { NotificationHub } from "./realtime/notification-hub";
import { openEvents } from "./test-open-events";
import { createTestApp, loginAs, type TestApp } from "./testing/login";

const sentry = createTestTransport();

/** A notification hub whose events the test sends, from outside any request. */
const listeners = new Set<(event: LiveEvent) => void>();
const hub: NotificationHub = {
  subscribe: (_channel, listener) => {
    const add = listener as (event: LiveEvent) => void;
    listeners.add(add);
    return () => listeners.delete(add);
  },
  listenerCount: () => listeners.size,
  close: async () => {},
};

let ctx: TestApp | undefined;
let admin: { userId: string; headers: { cookie: string } };
let origin: string;

beforeAll(async () => {
  // Before the app, as main.ts does.
  startServerMonitoring({
    service: "api",
    settings: {
      dsn: undefined,
      browserDsn: undefined,
      environment: "development",
      release: "test",
    },
    transport: sentry.transport,
  });
  ctx = await createTestApp(
    {},
    {
      logger: createLogger({ service: "api", level: "info", destination: { write() {} } }),
      notifications: hub,
    },
  );
  // A new message each time: Sentry's dedupe drops an event that repeats the one before it.
  let failures = 0;
  ctx.app.get("/api/monitoring-test/anonymous-error", async () => {
    throw new Error(`Failure without a login (${++failures})`);
  });
  admin = await loginAs(ctx, "monitoring-admin@example.test");
  await grantPlatformAdmin(
    ctx.t.db,
    { email: "monitoring-admin@example.test" },
    { kind: "system" },
  );
  await ctx.app.listen({ host: "127.0.0.1", port: 0 });
  origin = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await ctx?.close();
  await closeMonitoring();
});

test("the test error is one event with only the admin's id, and no cookie, header or body", async () => {
  const before = sentry.events().length;
  const res = await fetch(`${origin}/api/system/test-error`, {
    method: "POST",
    headers: { cookie: admin.headers.cookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "noor@example.test" }),
  });
  expect(res.status).toBe(500);
  await flushMonitoring();
  const events = sentry.events().slice(before);
  // Logged once as "Unexpected error"; Fastify's own capture is off, so not twice.
  expect(events).toHaveLength(1);
  const [event] = events;
  expect(event!.user).toEqual({ id: admin.userId });
  expect(event!.tags).toMatchObject({ service: "api" });
  expect(event!.request?.headers).toBeUndefined();
  expect(event!.request?.cookies).toBeUndefined();
  expect(event!.request?.data).toBeUndefined();
  const raw = JSON.stringify(sentry.envelopes());
  expect(raw).toContain("Test error requested by a platform admin");
  expect(raw).not.toContain("noor@example.test");
  const cookieValues = admin.headers.cookie
    .split("; ")
    .map((pair) => pair.slice(pair.indexOf("=") + 1));
  expect(cookieValues.length).toBeGreaterThan(0);
  for (const value of cookieValues) {
    expect(value.length).toBeGreaterThan(8);
    expect(raw).not.toContain(value);
    // The session token, also without its signature or URL encoding.
    expect(raw).not.toContain(decodeURIComponent(value).split(".")[0]);
  }
});

test("a request for /api/health is not traced; one for /api/version is", async () => {
  expect((await fetch(`${origin}/api/health`)).status).toBeLessThan(600);
  expect((await fetch(`${origin}/api/version`)).status).toBe(200);
  await flushMonitoring();
  const names = sentry.transactions().map((transaction) => transaction.transaction);
  expect(names).toContain("GET /api/version");
  expect(names.filter((name) => name?.includes("/api/health"))).toEqual([]);
});

test("a reload of the event stream's actor does not make later requests that user's", async () => {
  const stream = await openEvents(origin, admin.headers);
  try {
    expect(stream.status).toBe(200);
    for (let i = 0; listeners.size === 0 && i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // As the notification hub does: outside any request. The stream reloads its actor first.
    for (const listener of listeners) {
      listener({ type: "access-changed", userId: admin.userId });
    }
    expect((await stream.nextEvent()).event).toBe("access-changed");
  } finally {
    stream.close();
  }
  const before = sentry.events().length;
  expect((await fetch(`${origin}/api/monitoring-test/anonymous-error`)).status).toBe(500);
  await flushMonitoring();
  const events = sentry.events().slice(before);
  expect(events).toHaveLength(1);
  expect(events[0]!.user).toBeUndefined();
});

test("loadActor never makes the actor the Sentry user; only requireActor does", async () => {
  // Outside any request, as the event stream's reloads run: the process's own isolation scope.
  expect(
    await loadActor(ctx!.app, ctx!.t.db, { headers: admin.headers } as FastifyRequest),
  ).not.toBeNull();
  const before = sentry.events().length;
  expect((await fetch(`${origin}/api/monitoring-test/anonymous-error`)).status).toBe(500);
  await flushMonitoring();
  const events = sentry.events().slice(before);
  expect(events).toHaveLength(1);
  expect(events[0]!.user).toBeUndefined();
});

test("a mail sent in the background is a mail.send transaction of its own", async () => {
  const mailer = createMemoryMailer();
  let outerTraceId: string | undefined;
  await withSpan("outer", "test", {}, async () => {
    outerTraceId = Sentry.getActiveSpan()?.spanContext().traceId;
    sendInBackground(mailer, ctx!.app.log, [
      { to: "mail-span@example.test", subject: "s", text: "t", html: "h", kind: "approved" },
    ]);
  });
  const mailTransaction = async () => {
    await flushMonitoring();
    return sentry.transactions().find((transaction) => transaction.transaction === "mail.send");
  };
  let found = await mailTransaction();
  for (let i = 0; found === undefined && i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    found = await mailTransaction();
  }
  expect(mailer.sent).toHaveLength(1);
  expect(found?.contexts?.trace).toMatchObject({ op: "mail", data: { "mail.kind": "approved" } });
  expect(outerTraceId).toBeDefined();
  expect(found!.contexts!.trace!.trace_id).not.toBe(outerTraceId);
  expect(JSON.stringify(sentry.envelopes())).not.toContain("mail-span@example.test");
});
