import type { AddressInfo } from "node:net";
import { grantPlatformAdmin } from "@padvinder/db";
import { createLogger } from "@padvinder/logging";
import { closeMonitoring, flushMonitoring, startServerMonitoring } from "@padvinder/monitoring";
import { createTestTransport } from "@padvinder/monitoring/testing";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestApp, loginAs, type TestApp } from "./testing/login";

const sentry = createTestTransport();
let ctx: TestApp | undefined;
let admin: { userId: string; headers: { cookie: string } };
let origin: string;

beforeAll(async () => {
  // Before the app, as main.ts does.
  startServerMonitoring({
    service: "api",
    settings: { dsn: undefined, environment: "development", release: "test" },
    transport: sentry.transport,
  });
  ctx = await createTestApp(
    {},
    { logger: createLogger({ service: "api", level: "info", destination: { write() {} } }) },
  );
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
