import { createDb } from "@padvinder/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer } from "../mail/mailer";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";

const { db, pool } = createDb("postgres://padvinder:padvinder@127.0.0.1:1/none");
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    env: testEnv,
    db,
    notifications: createNoopNotificationHub(),
    mailer: createMemoryMailer(),
  });
  // Test-only route: the app has no state-changing route yet.
  app.post("/api/test-echo", async () => ({ ok: true }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

const post = (headers: Record<string, string>) =>
  app.inject({ method: "POST", url: "/api/test-echo", headers });

test("403 for a foreign Origin, with code origin_not_allowed", async () => {
  const res = await post({ origin: "https://evil.example" });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toEqual({
    statusCode: 403,
    error: "Forbidden",
    message: "Origin not allowed",
    code: "origin_not_allowed",
  });
});

test("403 for a foreign Origin, also on an unknown path", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/nope",
    headers: { origin: "https://evil.example" },
  });
  expect(res.statusCode).toBe(403);
});

test("passes for an allowed Origin", async () => {
  expect((await post({ origin: "http://localhost:4101" })).statusCode).toBe(200);
});

test("passes without an Origin header", async () => {
  expect((await post({})).statusCode).toBe(200);
});

test("GET is never blocked", async () => {
  const res = await app.inject({
    url: "/api/version",
    headers: { origin: "https://evil.example" },
  });
  expect(res.statusCode).toBe(200);
});

test("no CORS headers for other sites", async () => {
  const res = await app.inject({
    method: "OPTIONS",
    url: "/api/version",
    headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
  });
  expect(res.headers["access-control-allow-origin"]).toBeUndefined();
});

test("403 for Origin: null", async () => {
  expect((await post({ origin: "null" })).statusCode).toBe(403);
});
