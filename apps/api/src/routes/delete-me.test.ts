import {
  auditLogEntries,
  grantCoordinator,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  organizations,
  verifications,
  liveEventsChannel,
  membershipRequests,
  organizationAdmins,
  revokePlatformAdmin,
  users,
  workingGroupMemberships,
} from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer, createMemoryMailQueue } from "@padvinder/mail";
import { startNotificationHub, type NotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import { openEvents } from "../test-open-events";
import { createCast, expectStatuses, type Cast, type CastLogin } from "../testing/cast";
import { createTestApp, loginAs, requestCode, type TestApp } from "../testing/login";

// Every test deletes accounts of the cast, so every test gets its own database, hub and cast.
let t: TestDatabase | undefined;
let hub: NotificationHub | undefined;
let app: FastifyInstance | undefined;
let ctx: TestApp;
let cast: Cast;
let baseUrl = "";

beforeEach(async () => {
  t = await createTestDatabase();
  const logger = (await import("fastify")).default({ logger: false }).log;
  hub = await startNotificationHub({ databaseUrl: t.url, channels: [liveEventsChannel], logger });
  const mailer = createMemoryMailer();
  const mailQueue = createMemoryMailQueue();
  app = await buildApp({
    env: testEnv,
    db: t.db,
    notifications: hub,
    mailer,
    queueMail: mailQueue.queueMail,
  });
  ctx = { app, mailer, mailQueue, t, close: async () => {} };
  cast = await createCast(ctx);
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterEach(async () => {
  await app?.close();
  await hub?.close();
  await t?.drop();
});

type Who = { headers: Record<string, string> };

const del = (who: Who) =>
  ctx.app.inject({ method: "DELETE", url: "/api/me", headers: who.headers });
const me = (who: Who) => ctx.app.inject({ url: "/api/me", headers: who.headers });
const userRow = async (id: string) =>
  (await ctx.t.db.select().from(users).where(eq(users.id, id)))[0]!;
const setCookies = (res: { headers: Record<string, unknown> }): string[] =>
  [res.headers["set-cookie"] ?? []].flat() as string[];

/** Asks to join a group through the API, as the app does; returns the request's id. */
async function requestToJoin(who: CastLogin, workingGroupId: string): Promise<string> {
  const id = uuidv7();
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/membership-requests",
    headers: who.headers,
    payload: { id, workingGroupId, requestedAt: "2027-01-10T18:00:00+01:00" },
  });
  expect(res.statusCode).toBe(201);
  return id;
}

/** The mails about requests (not the login codes) sent so far. */
const requestMails = () => ctx.mailer.sent.filter((mail) => !mail.subject.includes("inlogcode"));

test("who may delete their account", async () => {
  // The platform admin is the only one; the admins and coordinators are the only ones of their
  // organization or working group.
  await expectStatuses(
    cast,
    {
      platformAdmin: 409,
      organizationAdmin: 409,
      coordinator: 409,
      volunteer: 204,
      volunteerOtherGroup: 204,
      coordinatorOtherOrganization: 409,
      organizationAdminOtherOrganization: 409,
      applicant: 204,
      anonymous: 401,
    },
    (headers) => del({ headers }),
  );
});

test("deleting wipes the personal fields and keeps the row", async () => {
  await ctx.t.db
    .update(users)
    .set({ phone: "06 12345678" })
    .where(eq(users.id, cast.members.volunteer.userId));
  const res = await del(cast.members.volunteer);
  expect(res.statusCode).toBe(204);
  expect(res.body).toBe("");
  const row = await userRow(cast.members.volunteer.userId);
  expect(row).toMatchObject({
    name: "Verwijderd account",
    email: `deleted-${row.id}@deleted.invalid`,
    phone: null,
    isPlatformAdmin: false,
  });
  expect(row.deletedAt).toBeInstanceOf(Date);
});

test("the answer clears the session cookie with the attributes it was set with", async () => {
  const res = await del(cast.members.volunteer);
  const cookie = setCookies(res).find((c) => c.startsWith("padvinder.session_token="));
  expect(cookie).toBeDefined();
  expect(cookie).toMatch(/^padvinder\.session_token=;/);
  expect(cookie).toMatch(/Max-Age=0/i);
  expect(cookie).toMatch(/Path=\//);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).not.toMatch(/;\s*Secure/i); // plain http origin in tests
});

test("on an HTTPS origin the cleared cookie is Secure, with the __Secure- name", async () => {
  const secure = await createTestApp({
    PUBLIC_ORIGIN: "https://padvinder.test",
    ALLOWED_ORIGINS: ["https://padvinder.test"],
  });
  try {
    const login = await loginAs(secure, "veilig@example.test");
    const res = await secure.app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: login.headers,
    });
    expect(res.statusCode).toBe(204);
    const cookie = setCookies(res).find((c) => c.startsWith("__Secure-padvinder.session_token="));
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  } finally {
    await secure.close();
  }
});

test("a login code that was asked for but not used is gone with the account", async () => {
  // Through Better Auth's real route, so a change of how it names its rows fails this test.
  const volunteer = cast.members.volunteer;
  expect((await requestCode(ctx, volunteer.email)).statusCode).toBe(200);
  const before = await ctx.t.db.select().from(verifications);
  expect(before.some((row) => row.identifier.includes(volunteer.email))).toBe(true);
  expect((await del(volunteer)).statusCode).toBe(204);
  const after = await ctx.t.db.select().from(verifications);
  expect(after.filter((row) => row.identifier.includes(volunteer.email))).toEqual([]);
});

test("the old session no longer works", async () => {
  expect((await del(cast.members.volunteer)).statusCode).toBe(204);
  const res = await me(cast.members.volunteer);
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ code: "not_logged_in" });
});

test("memberships and admin rows are gone; a pending request is withdrawn", async () => {
  const coordinator = cast.members.coordinator;
  const organizationAdmin = cast.members.organizationAdmin;
  // Neither is the only one: the volunteer is a second coordinator and a second admin.
  const system = { kind: "system" } as const;
  const volunteerEmail = cast.members.volunteer.email;
  await grantCoordinator(
    ctx.t.db,
    { email: volunteerEmail, workingGroupId: cast.workingGroup.workingGroupId },
    system,
  );
  await grantOrganizationAdmin(
    ctx.t.db,
    { email: volunteerEmail, organizationId: cast.organization.id },
    system,
  );
  // The organization admin is also a coordinator of the other group, with a pending request.
  await ctx.t.db.insert(workingGroupMemberships).values({
    userId: organizationAdmin.userId,
    workingGroupId: cast.otherGroup.workingGroupId,
    isCoordinator: true,
  });
  const requestId = await requestToJoin(coordinator, cast.otherGroup.workingGroupId);

  expect((await del(coordinator)).statusCode).toBe(204);
  expect((await del(organizationAdmin)).statusCode).toBe(204);

  for (const userId of [coordinator.userId, organizationAdmin.userId]) {
    expect(
      await ctx.t.db
        .select()
        .from(workingGroupMemberships)
        .where(eq(workingGroupMemberships.userId, userId)),
    ).toEqual([]);
    expect(
      await ctx.t.db.select().from(organizationAdmins).where(eq(organizationAdmins.userId, userId)),
    ).toEqual([]);
  }
  const [request] = await ctx.t.db
    .select()
    .from(membershipRequests)
    .where(eq(membershipRequests.id, requestId));
  expect(request!.status).toBe("withdrawn");
  // The list of the group's members no longer has them.
  const members = await ctx.app.inject({
    url: `/api/working-groups/${cast.workingGroup.workingGroupId}/members`,
    headers: cast.members.platformAdmin.headers,
  });
  expect(members.json().members.map((m: { userId: string }) => m.userId)).not.toContain(
    coordinator.userId,
  );
  expect(members.body).not.toContain("Verwijderd account");
});

test("the same address logs in again as a new account without a name", async () => {
  expect((await del(cast.members.volunteer)).statusCode).toBe(204);
  const again = await loginAs(ctx, cast.members.volunteer.email, { name: "" });
  expect(again.userId).not.toBe(cast.members.volunteer.userId);
  const res = await me(again);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({
    user: { id: again.userId, name: "", email: cast.members.volunteer.email, phone: null },
    memberships: [],
    organizationAdminOf: [],
    membershipRequest: null,
  });
  // The old row stays deleted and keeps its replaced address.
  expect(await userRow(cast.members.volunteer.userId)).toMatchObject({
    email: `deleted-${cast.members.volunteer.userId}@deleted.invalid`,
  });
});

test("the only platform admin is refused with 409 last_platform_admin", async () => {
  const admin = cast.members.platformAdmin;
  const res = await del(admin);
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ statusCode: 409, code: "last_platform_admin" });
  expect(setCookies(res).join("\n")).not.toContain("session_token");
  expect(await userRow(admin.userId)).toMatchObject({
    email: admin.email.toLowerCase(),
    isPlatformAdmin: true,
    deletedAt: null,
  });
  expect((await me(admin)).statusCode).toBe(200);
});

test("a blocked deletion answers 409 last_coordinator with the blockers, and the session stays", async () => {
  const coordinator = cast.members.coordinator;
  const res = await del(coordinator);
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({
    statusCode: 409,
    error: "Conflict",
    message: expect.any(String),
    code: "last_coordinator",
    blockers: [
      {
        role: "coordinator",
        workingGroupName: "Cast Werkgroep",
        organizationName: "Cast Organisatie",
        contactEmail: null,
      },
    ],
  });
  expect(setCookies(res).join("\n")).not.toContain("session_token");
  expect(await userRow(coordinator.userId)).toMatchObject({
    email: coordinator.email.toLowerCase(),
    deletedAt: null,
  });
  expect((await me(coordinator)).statusCode).toBe(200);
  const entries = await ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(eq(auditLogEntries.action, "account.deleted"));
  expect(entries).toEqual([]);
});

test("the last admin gets 409 last_organization_admin, with the contact address to ask", async () => {
  await ctx.t.db
    .update(organizations)
    .set({ contactEmail: "contact-cast@example.test" })
    .where(eq(organizations.id, cast.organization.id));
  const res = await del(cast.members.organizationAdmin);
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({
    code: "last_organization_admin",
    blockers: [
      {
        role: "organizationAdmin",
        workingGroupName: null,
        organizationName: "Cast Organisatie",
        contactEmail: "contact-cast@example.test",
      },
    ],
  });
});

test("an admin who is also the only coordinator: the code follows the first blocker, a group", async () => {
  const admin = cast.members.organizationAdmin;
  await grantCoordinator(
    ctx.t.db,
    { email: admin.email, workingGroupId: cast.otherGroup.workingGroupId },
    { kind: "system" },
  );
  // otherGroup now has two coordinators; foreignGroup gets the admin as its only one.
  await ctx.t.db
    .delete(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, cast.foreignGroup.workingGroupId));
  await ctx.t.db.insert(workingGroupMemberships).values({
    userId: admin.userId,
    workingGroupId: cast.foreignGroup.workingGroupId,
    isCoordinator: true,
  });
  const res = await del(admin);
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({
    code: "last_coordinator",
    blockers: [
      { role: "coordinator", workingGroupName: "Cast Vreemde werkgroep" },
      { role: "organizationAdmin", organizationName: "Cast Organisatie" },
    ],
  });
});

test("the last platform admin still gets 409 last_platform_admin without blockers", async () => {
  const res = await del(cast.members.platformAdmin);
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({
    statusCode: 409,
    error: "Conflict",
    message: expect.any(String),
    code: "last_platform_admin",
  });
  expect(res.body).not.toContain("blockers");
});

test("with a second platform admin it works", async () => {
  await grantPlatformAdmin(ctx.t.db, { email: cast.members.volunteer.email }, { kind: "system" });
  expect((await del(cast.members.platformAdmin)).statusCode).toBe(204);
  expect(await userRow(cast.members.platformAdmin.userId)).toMatchObject({
    isPlatformAdmin: false,
  });
  // The volunteer is now the last one.
  await expect(
    revokePlatformAdmin(ctx.t.db, { email: cast.members.volunteer.email }, { kind: "system" }),
  ).rejects.toMatchObject({ code: "last_platform_admin" });
  expect((await del(cast.members.volunteer)).statusCode).toBe(409);
});

test("one audit entry, with the user's id and no personal data", async () => {
  const volunteer = cast.members.volunteer;
  expect((await del(volunteer)).statusCode).toBe(204);
  const entries = await ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(eq(auditLogEntries.action, "account.deleted"));
  expect(entries).toEqual([
    expect.objectContaining({
      actorKind: "user",
      actorUserId: volunteer.userId,
      organizationId: null,
      subjectType: "user",
      subjectId: volunteer.userId,
      details: {},
    }),
  ]);
  const text = JSON.stringify(entries);
  expect(text).not.toContain("@");
  expect(text).not.toContain("Cast volunteer");
});

test("the user's open stream ends", async () => {
  const before = hub!.listenerCount(liveEventsChannel);
  const stream = await openEvents(baseUrl, cast.members.volunteer.headers);
  try {
    expect(stream.status).toBe(200);
    await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(before + 1);
    expect((await del(cast.members.volunteer)).statusCode).toBe(204);
    await expect(stream.nextEvent()).rejects.toThrow("Stream ended before the next event");
    expect(stream.received()).not.toContain("event:");
  } finally {
    stream.close();
  }
});

test("the coordinator's stream hears about the withdrawn request", async () => {
  await requestToJoin(cast.members.applicant, cast.workingGroup.workingGroupId);
  const before = hub!.listenerCount(liveEventsChannel);
  const stream = await openEvents(baseUrl, cast.members.coordinator.headers);
  try {
    expect(stream.status).toBe(200);
    await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(before + 1);
    expect((await del(cast.members.applicant)).statusCode).toBe(204);
    await expect(stream.nextEvent()).resolves.toEqual({
      event: "membership-requests-changed",
      data: {
        type: "membership-requests-changed",
        workingGroupId: cast.workingGroup.workingGroupId,
        organizationId: cast.organization.id,
      },
    });
  } finally {
    stream.close();
  }
});

test("a request the deleted user sent still exists and shows Verwijderd account to the coordinator", async () => {
  const applicant = cast.members.applicant;
  const id = await requestToJoin(applicant, cast.workingGroup.workingGroupId);
  const rejected = await ctx.app.inject({
    method: "POST",
    url: `/api/membership-requests/${id}/reject`,
    headers: cast.members.coordinator.headers,
  });
  expect(rejected.statusCode).toBe(200);
  expect((await del(applicant)).statusCode).toBe(204);

  const res = await ctx.app.inject({
    url: `/api/membership-requests/${id}`,
    headers: cast.members.coordinator.headers,
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ id, status: "rejected" });
  // No contact keys at all in the raw answer: not an empty string, not null.
  expect(res.json().applicant).toStrictEqual({ id: applicant.userId, name: "Verwijderd account" });
  expect(res.body).not.toContain('"email"');
  expect(res.body).not.toContain('"phone"');
  // Neither the old address nor the replaced one reaches the reviewer.
  expect(res.body).not.toContain(applicant.email);
  expect(res.body).not.toContain("deleted.invalid");
});

test("a deleted coordinator no longer receives request mails", async () => {
  const coordinator = cast.members.coordinator;
  // The volunteer is the second coordinator, so the first may go.
  await grantCoordinator(
    ctx.t.db,
    { email: cast.members.volunteer.email, workingGroupId: cast.workingGroup.workingGroupId },
    { kind: "system" },
  );
  expect((await del(coordinator)).statusCode).toBe(204);
  const before = requestMails().length;
  await requestToJoin(cast.members.applicant, cast.workingGroup.workingGroupId);
  // Only the remaining coordinator gets it.
  await expect.poll(() => requestMails().length - before).toBe(1);
  const mails = requestMails().slice(before);
  expect(mails.map((mail) => mail.to)).toEqual([cast.members.volunteer.email.toLowerCase()]);
  const deleted = (await userRow(coordinator.userId)).email;
  expect(mails.map((mail) => mail.to)).not.toContain(deleted);
});

test("deleting twice: the second call has no session, so 401", async () => {
  expect((await del(cast.members.volunteer)).statusCode).toBe(204);
  const again = await del(cast.members.volunteer);
  expect(again.statusCode).toBe(401);
  expect(again.json()).toMatchObject({ code: "not_logged_in" });
  const entries = await ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(
      and(
        eq(auditLogEntries.action, "account.deleted"),
        eq(auditLogEntries.subjectId, cast.members.volunteer.userId),
      ),
    );
  expect(entries).toHaveLength(1);
});

test("a DELETE from a foreign Origin is refused", async () => {
  const volunteer = cast.members.volunteer;
  const res = await del({ headers: { ...volunteer.headers, origin: "https://evil.example" } });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ code: "origin_not_allowed" });
  expect(await userRow(volunteer.userId)).toMatchObject({
    email: volunteer.email,
    deletedAt: null,
  });
  expect((await me(volunteer)).statusCode).toBe(200);
});

test("a DELETE from our own Origin works", async () => {
  const volunteer = cast.members.volunteer;
  const res = await del({ headers: { ...volunteer.headers, origin: testEnv.PUBLIC_ORIGIN } });
  expect(res.statusCode).toBe(204);
});

test("is in the OpenAPI description as deleteMe", async () => {
  await ctx.app.ready();
  const paths = (ctx.app.swagger() as { paths: Record<string, Record<string, unknown>> }).paths;
  expect(paths["/api/me"]?.delete).toMatchObject({ operationId: "deleteMe" });
});
