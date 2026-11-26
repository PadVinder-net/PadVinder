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

test("request lines have service api, a reqId, no address and a scrubbed URL", async () => {
  await app!.inject("/api/version?email=a@b.test");
  const incoming = log
    .entries()
    .filter((e) => e.msg === "incoming request")
    .at(-1)!;
  expect(incoming).toMatchObject({ service: "test", reqId: expect.any(String) });
  expect(incoming.req).toEqual({
    method: "GET",
    url: "/api/version?email=[email]",
    host: expect.any(String),
  });
});
