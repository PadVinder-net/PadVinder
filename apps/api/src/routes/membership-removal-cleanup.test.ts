import { sql } from "drizzle-orm";
import { users, workingGroupMemberships } from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import type { FastifyInstance } from "fastify";
import { Writable } from "node:stream";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer, createMemoryMailQueue } from "@padvinder/mail";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import { createCast, type Cast } from "../testing/cast";
import type { TestApp } from "../testing/login";
import { describeDatabaseError } from "./memberships";

let t: TestDatabase | undefined;
let app: FastifyInstance | undefined;
let cast: Cast;
const logLines: string[] = [];

beforeAll(async () => {
  t = await createTestDatabase();
  const mailer = createMemoryMailer();
  const mailQueue = createMemoryMailQueue();
  app = await buildApp({
    env: testEnv,
    db: t.db,
    notifications: createNoopNotificationHub(),
    mailer,
    queueMail: mailQueue.queueMail,
    logger: true,
    logStream: new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(String(chunk));
        callback();
      },
    }),
  });
  const ctx: TestApp = { app, mailer, mailQueue, t, close: async () => {} };
  cast = await createCast(ctx);
});
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

let added = 0;
/** A member of the cast's working group whose account never logged in. */
async function addUnusedMember() {
  const email = `ongebruikt-${added++}@example.test`;
  const [user] = await t!.db
    .insert(users)
    .values({ name: "Geheime Naam", email, emailVerified: false })
    .returning({ id: users.id });
  const [membership] = await t!.db
    .insert(workingGroupMemberships)
    .values({ userId: user!.id, workingGroupId: cast.workingGroup.workingGroupId })
    .returning({ id: workingGroupMemberships.id });
  return { email, userId: user!.id, membershipId: membership!.id };
}

const remove = (membershipId: string) =>
  app!.inject({
    method: "DELETE",
    url: `/api/memberships/${membershipId}`,
    headers: cast.members.coordinator.headers,
  });

const cleanupLog = () => logLines.filter((line) => line.includes("after a removal failed"));

test("a removal that deletes the unused account answers 204 and logs nothing", async () => {
  const member = await addUnusedMember();
  logLines.length = 0;
  expect((await remove(member.membershipId)).statusCode).toBe(204);
  expect(cleanupLog()).toEqual([]);
});

test("when deleting the unused account fails, the answer stays 204 and a warning without personal data is logged", async () => {
  const member = await addUnusedMember();
  await t!.db.execute(
    sql.raw(`create function refuse_deletion() returns trigger language plpgsql as $$
      begin raise exception 'refused for %', old.email; end $$;
      create trigger refuse_deletion before update on users for each row
      when (old.id = '${member.userId}' and new.deleted_at is not null) execute function refuse_deletion();`),
  );
  try {
    logLines.length = 0;
    const res = await remove(member.membershipId);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    const [line] = cleanupLog();
    expect(JSON.parse(line!)).toMatchObject({
      level: 40,
      cleanupError: { code: "P0001" },
    });
    const log = logLines.join("");
    expect(log).not.toContain(member.email);
    expect(log).not.toContain("Geheime");
    expect(log).not.toContain("refused for");
  } finally {
    await t!.db.execute(
      sql.raw(`drop trigger refuse_deletion on users; drop function refuse_deletion();`),
    );
  }
});

test("describeDatabaseError keeps the class and the SQLSTATE code, never the message", () => {
  const pgError = Object.assign(new Error("Key (email)=(jan@example.test) exists"), {
    code: "23505",
  });
  const wrapped = new Error("Failed query: update users", { cause: pgError });
  expect(describeDatabaseError(wrapped)).toEqual({ type: "Error", code: "23505" });
  expect(describeDatabaseError(new TypeError("jan@example.test"))).toEqual({ type: "TypeError" });
  expect(describeDatabaseError("jan@example.test")).toEqual({ type: "string" });
});
