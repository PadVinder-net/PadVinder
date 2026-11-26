import { Writable } from "node:stream";
import { accountDeletionBlockedSchema } from "@padvinder/contracts";
import {
  auditLogEntries,
  createMembershipRequest,
  createOrganization,
  createWorkingGroup,
  deletedAccountEmail,
  DELETED_ACCOUNT_NAME,
  grantCoordinator,
  grantPlatformAdmin,
  membershipRequests,
  sessions,
  users,
  workingGroupMemberships,
} from "@padvinder/db";
import { createTestDatabase } from "@padvinder/db/testing";
import { createMemoryMailer, createMemoryMailQueue } from "@padvinder/mail";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../app";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import { createCast, expectStatuses, type Cast, type CastLogin } from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";

let ctx: TestApp;
let cast: Cast;
beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);
});
afterAll(() => ctx.close());

const system = { kind: "system" } as const;

type Headers = Record<string, string>;
type Who = CastLogin | { headers: Headers };
const lookup = (who: Who, payload: object, app = ctx.app) =>
  app.inject({ method: "POST", url: "/api/users/lookup", headers: who.headers, payload });
const remove = (who: Who, userId: string) =>
  ctx.app.inject({ method: "DELETE", url: `/api/users/${userId}`, headers: who.headers });
const me = (who: Who) => ctx.app.inject({ method: "GET", url: "/api/me", headers: who.headers });

let n = 0;
const uniqueAddress = (label: string) => `${label}-${++n}-${uuidv7().slice(-8)}@example.test`;

const platformOnly = (ok: number) => ({
  platformAdmin: ok,
  organizationAdmin: 403,
  coordinator: 403,
  volunteer: 403,
  volunteerOtherGroup: 403,
  coordinatorOtherOrganization: 403,
  organizationAdminOtherOrganization: 403,
  applicant: 403,
  anonymous: 401,
});

const userRow = async (id: string) =>
  (await ctx.t.db.select().from(users).where(eq(users.id, id)))[0]!;
const sessionsOf = (userId: string) =>
  ctx.t.db.select().from(sessions).where(eq(sessions.userId, userId));
const deletedEntries = (userId: string) =>
  ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(
      and(eq(auditLogEntries.subjectId, userId), eq(auditLogEntries.action, "account.deleted")),
    );

/** A fresh account that logged in, with a name and a phone number. */
async function someone(label: string) {
  const email = uniqueAddress(label);
  const login = await loginAs(ctx, email, { name: "Mees Jansen", phone: "06 12345678" });
  return { ...login, email };
}

let organizationCount = 0;
/** A fresh organization whose only admin is `adminEmail`. */
async function newOrganization(adminEmail: string, contactEmail: string | null = null) {
  const name = `Verwijder Org ${++organizationCount}`;
  const { id } = await createOrganization(db(), { name, adminEmail, contactEmail }, system);
  return { id, name };
}
const db = () => ctx.t.db;

/** A fresh active working group whose only coordinator is `coordinatorEmail`. */
async function newGroup(coordinatorEmail: string) {
  const organization = await newOrganization(uniqueAddress("org-beheerder"));
  const name = `Verwijder Werkgroep ${organizationCount}`;
  const { id } = await createWorkingGroup(
    db(),
    { organizationId: organization.id, name, city: "Voorbeeldstad", coordinatorEmail },
    system,
  );
  return { id, name, organization };
}

test("only a platform admin looks up an account", async () =>
  await expectStatuses(cast, platformOnly(200), (headers) =>
    lookup({ headers }, { email: cast.members.volunteer.email }),
  ));

test("an address without an account is 404 for a platform admin and still 403 for everyone else", async () => {
  const email = uniqueAddress("niemand");
  await expectStatuses(cast, platformOnly(404), (headers) => lookup({ headers }, { email }));
  const res = await lookup(cast.members.platformAdmin, { email });
  expect(res.json()).toMatchObject({ code: "not_found" });
  expect(res.body).not.toContain("@");
});

test("only a platform admin deletes someone's account", async () =>
  await expectStatuses(cast, platformOnly(204), async (headers) => {
    const target = await someone("weg");
    return remove({ headers }, target.userId);
  }));

test("the lookup answers id, name, address and working groups, and no phone number", async () => {
  const target = await someone("opzoeken");
  await db()
    .insert(workingGroupMemberships)
    .values({ userId: target.userId, workingGroupId: cast.otherGroup.workingGroupId });
  const res = await lookup(cast.members.platformAdmin, { email: ` ${target.email.toUpperCase()}` });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    id: target.userId,
    name: "Mees Jansen",
    email: target.email,
    hasLoggedIn: true,
    isPlatformAdmin: false,
    organizationAdminOf: [],
    workingGroups: [
      {
        id: cast.otherGroup.workingGroupId,
        name: "Cast Andere werkgroep",
        organization: { id: cast.organization.id, name: "Cast Organisatie" },
        isCoordinator: false,
      },
    ],
  });
  expect(res.body).not.toContain('"phone"');
  expect(res.body).not.toContain("12345678");
});

test("an unknown address is 404; 'noor' and 'deleted-…@deleted.invalid' are 400; an empty body and an unknown key are 400", async () => {
  const admin = cast.members.platformAdmin;
  const unknown = uniqueAddress("onbekend");
  const notFound = await lookup(admin, { email: unknown });
  expect(notFound.statusCode).toBe(404);
  expect(notFound.body).not.toContain(unknown);
  const replaced = deletedAccountEmail(uuidv7());
  for (const body of [
    { email: "noor" },
    { email: replaced },
    {},
    { email: cast.members.volunteer.email, extra: 1 },
  ]) {
    const res = await lookup(admin, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json()).toMatchObject({ code: "invalid_request" });
    expect(res.body).not.toContain(replaced);
    expect(res.body).not.toContain(cast.members.volunteer.email);
  }
});

test("the request log of a lookup holds no address", async () => {
  const lines: string[] = [];
  const t = await createTestDatabase();
  const mailer = createMemoryMailer();
  const mailQueue = createMemoryMailQueue();
  const app = await buildApp({
    env: testEnv,
    db: t.db,
    notifications: createNoopNotificationHub(),
    mailer,
    queueMail: mailQueue.queueMail,
    logger: true,
    logStream: new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    }),
  });
  try {
    const logged: TestApp = { app, mailer, mailQueue, t, close: async () => {} };
    const admin = await loginAs(logged, "log-hoofdbeheerder@example.test");
    await grantPlatformAdmin(t.db, { email: "log-hoofdbeheerder@example.test" }, system);
    const from = lines.length;
    const statuses = [];
    for (const email of ["log-hoofdbeheerder@example.test", "log-niemand@example.test", "noor"]) {
      statuses.push((await lookup(admin, { email }, app)).statusCode);
    }
    expect(statuses).toEqual([200, 404, 400]);
    const lookupLines = lines.slice(from);
    expect(lookupLines.join("")).toContain("/api/users/lookup");
    for (const line of lookupLines) expect(line).not.toContain("@");
  } finally {
    await app.close();
    await t.drop();
  }
});

test("deleting wipes the name, address and phone, ends the sessions and removes the memberships", async () => {
  const target = await someone("wissen");
  await db()
    .insert(workingGroupMemberships)
    .values({ userId: target.userId, workingGroupId: cast.otherGroup.workingGroupId });
  expect((await me(target)).statusCode).toBe(200);
  const res = await remove(cast.members.platformAdmin, target.userId);
  expect(res.statusCode).toBe(204);
  expect(await userRow(target.userId)).toMatchObject({
    name: DELETED_ACCOUNT_NAME,
    email: deletedAccountEmail(target.userId),
    phone: null,
    deletedAt: expect.any(Date),
  });
  expect(await sessionsOf(target.userId)).toEqual([]);
  expect(
    await db()
      .select()
      .from(workingGroupMemberships)
      .where(eq(workingGroupMemberships.userId, target.userId)),
  ).toEqual([]);
  expect((await me(target)).statusCode).toBe(401);
});

test("the entry account.deleted names the platform admin as actor and holds no details", async () => {
  const target = await someone("audit");
  expect((await remove(cast.members.platformAdmin, target.userId)).statusCode).toBe(204);
  expect(await deletedEntries(target.userId)).toEqual([
    expect.objectContaining({
      actorKind: "user",
      actorUserId: cast.members.platformAdmin.userId,
      organizationId: null,
      subjectType: "user",
      subjectId: target.userId,
      details: {},
    }),
  ]);
});

test("an applicant and an account that never logged in can be deleted", async () => {
  const applicant = await someone("aanmelder");
  const requestId = uuidv7();
  const created = await createMembershipRequest(db(), {
    id: requestId,
    userId: applicant.userId,
    workingGroupId: cast.workingGroup.workingGroupId,
    requestedAt: new Date(),
    now: new Date(),
  });
  expect(created.outcome).toBe("created");
  expect((await remove(cast.members.platformAdmin, applicant.userId)).statusCode).toBe(204);
  const [request] = await db()
    .select()
    .from(membershipRequests)
    .where(eq(membershipRequests.id, requestId));
  expect(request?.status).toBe("withdrawn");

  const [unused] = await db()
    .insert(users)
    .values({ name: "", email: uniqueAddress("ongebruikt"), emailVerified: false })
    .returning({ id: users.id });
  expect((await remove(cast.members.platformAdmin, unused!.id)).statusCode).toBe(204);
  expect(await userRow(unused!.id)).toMatchObject({ deletedAt: expect.any(Date) });
});

test("the last coordinator of an active group is 409 last_coordinator with the blockers, and nothing changes", async () => {
  const target = await someone("coordinator");
  const group = await newGroup(target.email);
  const res = await remove(cast.members.platformAdmin, target.userId);
  expect(res.statusCode).toBe(409);
  const body = accountDeletionBlockedSchema.parse(res.json());
  expect(body).toMatchObject({
    code: "last_coordinator",
    blockers: [
      {
        role: "coordinator",
        workingGroupName: group.name,
        organizationName: group.organization.name,
        contactEmail: null,
      },
    ],
  });
  expect(await userRow(target.userId)).toMatchObject({
    name: "Mees Jansen",
    email: target.email,
    phone: "06 12345678",
    deletedAt: null,
  });
  expect(await sessionsOf(target.userId)).toHaveLength(1);
  expect(await deletedEntries(target.userId)).toEqual([]);
});

test("the last admin of an organization is 409 last_organization_admin with the blockers", async () => {
  const target = await someone("beheerder");
  const organization = await newOrganization(target.email, "contact-verwijder@example.test");
  const res = await remove(cast.members.platformAdmin, target.userId);
  expect(res.statusCode).toBe(409);
  expect(accountDeletionBlockedSchema.parse(res.json())).toMatchObject({
    code: "last_organization_admin",
    blockers: [
      {
        role: "organizationAdmin",
        workingGroupName: null,
        organizationName: organization.name,
        contactEmail: "contact-verwijder@example.test",
      },
    ],
  });
  expect(await userRow(target.userId)).toMatchObject({ deletedAt: null });
});

test("with a second coordinator the deletion goes through", async () => {
  const target = await someone("eerste");
  const group = await newGroup(target.email);
  await grantCoordinator(
    db(),
    { email: uniqueAddress("tweede"), workingGroupId: group.id },
    system,
  );
  expect((await remove(cast.members.platformAdmin, target.userId)).statusCode).toBe(204);
});

test("a platform admin deletes the account of another platform admin who has logged in", async () => {
  const other = await someone("andere-hoofdbeheerder");
  await grantPlatformAdmin(db(), { email: other.email }, system);
  expect(await userRow(other.userId)).toMatchObject({ isPlatformAdmin: true, emailVerified: true });
  expect((await remove(cast.members.platformAdmin, other.userId)).statusCode).toBe(204);
  expect(await userRow(other.userId)).toMatchObject({
    isPlatformAdmin: false,
    name: DELETED_ACCOUNT_NAME,
    email: deletedAccountEmail(other.userId),
    deletedAt: expect.any(Date),
  });
  expect(await sessionsOf(other.userId)).toEqual([]);
  expect(await deletedEntries(other.userId)).toMatchObject([
    { actorKind: "user", actorUserId: cast.members.platformAdmin.userId },
  ]);
});

test("a platform admin's own id is 409 own_account, and the account stays", async () => {
  const self = cast.members.platformAdmin;
  const res = await remove(self, self.userId);
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ code: "own_account" });
  expect(await userRow(self.userId)).toMatchObject({ deletedAt: null, isPlatformAdmin: true });
  expect(await deletedEntries(self.userId)).toEqual([]);
  expect((await me(self)).statusCode).toBe(200);
});

test("a second delete of the same id is 404; an unknown id is 404; an id that is not a UUID is 400", async () => {
  const admin = cast.members.platformAdmin;
  const target = await someone("tweemaal");
  expect((await remove(admin, target.userId)).statusCode).toBe(204);
  for (const userId of [target.userId, uuidv7()]) {
    const res = await remove(admin, userId);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  }
  expect(await deletedEntries(target.userId)).toHaveLength(1);
  const notUuid = await remove(admin, "abc");
  expect(notUuid.statusCode).toBe(400);
  expect(notUuid.json()).toMatchObject({ code: "invalid_request" });
});

test("after the deletion the same address is 404 in the lookup, and logs in as a new account", async () => {
  const admin = cast.members.platformAdmin;
  const target = await someone("opnieuw");
  expect((await remove(admin, target.userId)).statusCode).toBe(204);
  expect((await lookup(admin, { email: target.email })).statusCode).toBe(404);
  const again = await loginAs(ctx, target.email);
  expect(again.userId).not.toBe(target.userId);
  const res = await lookup(admin, { email: target.email });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ id: again.userId, workingGroups: [] });
});

test("a POST from a foreign Origin is refused", async () => {
  const foreign = { ...cast.members.platformAdmin.headers, origin: "https://evil.example" };
  const res = await lookup({ headers: foreign }, { email: cast.members.volunteer.email });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ code: "origin_not_allowed" });
  const target = await someone("vreemd");
  const deletion = await remove({ headers: foreign }, target.userId);
  expect(deletion.statusCode).toBe(403);
  expect(deletion.json()).toMatchObject({ code: "origin_not_allowed" });
  expect(await userRow(target.userId)).toMatchObject({ deletedAt: null });
  const own = await lookup(
    { headers: { ...cast.members.platformAdmin.headers, origin: testEnv.PUBLIC_ORIGIN } },
    { email: cast.members.volunteer.email },
  );
  expect(own.statusCode).toBe(200);
});
