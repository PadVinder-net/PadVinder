import { createTestLogger } from "@padvinder/logging/testing";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { createMemoryMailer, createMemoryMailQueue } from "@padvinder/mail";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "./app";
import { createNoopNotificationHub } from "./realtime/notification-hub";
import { testEnv } from "./test-env";

let t: TestDatabase | undefined;
let app: FastifyInstance | undefined;
const log = createTestLogger("info");

beforeAll(async () => {
  t = await createTestDatabase();
  const mailQueue = createMemoryMailQueue();
  app = await buildApp({
    env: testEnv,
    db: t.db,
    notifications: createNoopNotificationHub(),
    mailer: createMemoryMailer(),
    queueMail: mailQueue.queueMail,
    logger: log.logger,
  });
  app.get("/api/test-throw", async () => {
    throw Object.assign(
      new Error('duplicate key value violates unique constraint "users_email_key"'),
      {
        code: "23505",
        constraint: "users_email_key",
        table: "users",
        detail: "Key (lower(email))=(noor@example.test) already exists.",
        parameters: ["noor@example.test"],
      },
    );
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

test("an unexpected error is logged without the row's address", async () => {
  const res = await app!.inject("/api/test-throw");
  expect(res.statusCode).toBe(500);
  const line = log.entries().find((e) => e.msg === "Unexpected error")!;
  expect(line.err).toMatchObject({ code: "23505", constraint: "users_email_key" });
  expect(log.text()).not.toContain("noor@example.test");
});

test("one line per request, with method, path, status, response time and reqId", async () => {
  const before = log.entries().length;
  const res = await app!.inject("/api/version?email=noor%40example.test&phone=0612345678");
  expect(res.statusCode).toBe(200);
  const lines = log.entries().slice(before);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toEqual({
    level: "info",
    time: expect.any(Number),
    service: "test",
    reqId: expect.any(String),
    req: { method: "GET", url: "/api/version", host: expect.any(String) },
    res: { statusCode: 200 },
    responseTime: expect.any(Number),
    msg: "request completed",
  });
  expect(log.entries().some((e) => e.msg === "incoming request")).toBe(false);
  expect(log.text()).not.toContain("0612345678");
  expect(log.text()).not.toContain("example.test");
});

test("a failing request also gets exactly one request line", async () => {
  const before = log.entries().length;
  await app!.inject("/api/test-throw");
  const requestLines = log
    .entries()
    .slice(before)
    .filter((e) => e.msg === "request completed" || e.msg === "incoming request");
  expect(requestLines).toEqual([
    expect.objectContaining({ level: "info", res: { statusCode: 500 }, req: expect.any(Object) }),
  ]);
});
