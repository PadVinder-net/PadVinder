import {
  auditLogEntries,
  createWorkingGroup,
  liveEventsChannel,
  users,
  workingGroupMemberships,
} from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer } from "@padvinder/mail";
import { startNotificationHub, type NotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import { openEvents } from "../test-open-events";
import { createCast, expectStatuses, type Cast } from "../testing/cast";
import { loginAs, type TestApp } from "../testing/login";

let t: TestDatabase | undefined;
let hub: NotificationHub | undefined;
let app: FastifyInstance | undefined;
let ctx: TestApp;
let cast: Cast;
let baseUrl = "";

beforeAll(async () => {
  t = await createTestDatabase();
  const logger = (await import("fastify")).default({ logger: false }).log;
  hub = await startNotificationHub({ databaseUrl: t.url, channels: [liveEventsChannel], logger });
  const mailer = createMemoryMailer();
  app = await buildApp({
    env: testEnv,
    db: t.db,
    notifications: hub,
    mailer,
  });
  ctx = { app, mailer, t, close: async () => {} };
  cast = await createCast(ctx);
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await app?.close();
  await hub?.close();
  await t?.drop();
});

type Who = { headers: Record<string, string> };

const list = (who: Who, workingGroupId = cast.workingGroup.workingGroupId) =>
  ctx.app.inject({ url: `/api/working-groups/${workingGroupId}/members`, headers: who.headers });
const remove = (who: Who, membershipId: string) =>
  ctx.app.inject({
    method: "DELETE",
    url: `/api/memberships/${membershipId}`,
    headers: who.headers,
  });

let added = 0;
/** A fresh member of the cast's working group, who can log in. */
async function addMember(role: "volunteer" | "coordinator" = "volunteer") {
  const session = await loginAs(ctx, `lid-${added++}@example.test`, { name: `Lid ${added}` });
  const [row] = await ctx.t.db
    .insert(workingGroupMemberships)
    .values({
      userId: session.userId,
      workingGroupId: cast.workingGroup.workingGroupId,
      isCoordinator: role === "coordinator",
    })
    .returning({ id: workingGroupMemberships.id });
  return { ...session, membershipId: row!.id };
}
const membershipRows = (membershipId: string) =>
  ctx.t.db
    .select()
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.id, membershipId));

test("who may list the members", async () => {
  await expectStatuses(
    cast,
    {
      platformAdmin: 200,
      organizationAdmin: 200,
      coordinator: 200,
      volunteer: 200,
      volunteerOtherGroup: 404,
      coordinatorOtherOrganization: 404,
      organizationAdminOtherOrganization: 404,
      applicant: 404,
      anonymous: 401,
    },
    (headers) => list({ headers }),
  );
});

test("a volunteer gets names and the coordinator flag and no contact keys at all", async () => {
  const res = await list(cast.members.volunteer);
  const { members } = res.json();
  expect(members.length).toBeGreaterThanOrEqual(2);
  for (const member of members) {
    expect(Object.keys(member).sort()).toEqual(["isCoordinator", "membershipId", "name", "userId"]);
  }
  expect(res.body).not.toMatch(/example\.test/);
  expect(res.body).not.toContain('"phone"');
});

test("a volunteer's raw response has no hasLoggedIn key", async () => {
  const res = await list(cast.members.volunteer);
  expect(res.body).not.toContain("hasLoggedIn");
});

test("a coordinator, an organization admin and a platform admin get email and phone", async () => {
  await ctx.t.db
    .update(users)
    .set({ phone: "06 12345678" })
    .where(eq(users.id, cast.members.volunteer.userId));
  for (const who of [
    cast.members.coordinator,
    cast.members.organizationAdmin,
    cast.members.platformAdmin,
  ]) {
    const { members } = (await list(who)).json();
    const volunteer = members.find(
      (m: { userId: string }) => m.userId === cast.members.volunteer.userId,
    );
    expect(volunteer).toMatchObject({
      name: "Cast volunteer",
      isCoordinator: false,
      email: cast.members.volunteer.email,
      phone: "06 12345678",
      hasLoggedIn: true,
    });
  }
});

test("an unknown working group is 404", async () => {
  const res = await list(cast.members.platformAdmin, uuidv7());
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ code: "not_found" });
});

test("who may remove a volunteer", async () => {
  await expectStatuses(
    cast,
    {
      platformAdmin: 204,
      organizationAdmin: 204,
      coordinator: 204,
      volunteer: 403,
      volunteerOtherGroup: 404,
      coordinatorOtherOrganization: 404,
      organizationAdminOtherOrganization: 404,
      applicant: 404,
      anonymous: 401,
    },
    async (headers) => remove({ headers }, (await addMember()).membershipId),
  );
});

test("a coordinator may not remove a coordinator; the organization admin may", async () => {
  const other = await addMember("coordinator");
  const denied = await remove(cast.members.coordinator, other.membershipId);
  expect(denied.statusCode).toBe(403);
  expect(await membershipRows(other.membershipId)).toHaveLength(1);
  expect((await remove(cast.members.organizationAdmin, other.membershipId)).statusCode).toBe(204);
  expect(await membershipRows(other.membershipId)).toHaveLength(0);
});

test("removal writes one audit entry and sends access-changed to the removed user", async () => {
  const member = await addMember();
  const stream = await openEvents(baseUrl, member.headers);
  try {
    expect(stream.status).toBe(200);
    expect((await remove(cast.members.coordinator, member.membershipId)).statusCode).toBe(204);
    expect(await stream.nextEvent()).toEqual({
      event: "access-changed",
      data: { type: "access-changed", userId: member.userId },
    });
  } finally {
    stream.close();
  }
  const entries = await ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(
      and(
        eq(auditLogEntries.subjectId, member.userId),
        eq(auditLogEntries.action, "membership.removed"),
      ),
    );
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    actorUserId: cast.members.coordinator.userId,
    organizationId: cast.organization.id,
    details: { workingGroupId: cast.workingGroup.workingGroupId, role: "volunteer" },
  });
  expect(JSON.stringify(entries[0])).not.toMatch(/example\.test|Lid/);
});

test("the removed user's /api/me has no membership any more", async () => {
  const member = await addMember();
  const before = await ctx.app.inject({ url: "/api/me", headers: member.headers });
  expect(before.json().memberships).toHaveLength(1);
  await remove(cast.members.coordinator, member.membershipId);
  const after = await ctx.app.inject({ url: "/api/me", headers: member.headers });
  expect(after.json().memberships).toEqual([]);
});

test("removing twice is 404 the second time", async () => {
  const member = await addMember();
  expect((await remove(cast.members.coordinator, member.membershipId)).statusCode).toBe(204);
  const again = await remove(cast.members.coordinator, member.membershipId);
  expect(again.statusCode).toBe(404);
  expect(again.json()).toMatchObject({ code: "not_found" });
  expect((await remove(cast.members.platformAdmin, uuidv7())).statusCode).toBe(404);
});

test("a malformed id is 400", async () => {
  expect((await remove(cast.members.platformAdmin, "nope")).statusCode).toBe(400);
});

test("removing the last coordinator answers 409 last_coordinator", async () => {
  const group = await createWorkingGroup(
    ctx.t.db,
    {
      organizationId: cast.organization.id,
      name: "Eén coördinator",
      city: "Enschede",
      coordinatorEmail: "enige-coordinator@example.test",
    },
    { kind: "system" },
  );
  const [membership] = await ctx.t.db
    .select({ id: workingGroupMemberships.id })
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, group.id));
  const res = await remove(cast.members.organizationAdmin, membership!.id);
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ statusCode: 409, code: "last_coordinator" });
  expect(await membershipRows(membership!.id)).toHaveLength(1);
});

test("a member's event stream gets access-changed when the group is switched off", async () => {
  const created = await createWorkingGroup(
    ctx.t.db,
    {
      organizationId: cast.organization.id,
      name: `Uitgezet ${uuidv7().slice(-8)}`,
      city: "Enschede",
      coordinatorEmail: `uit-${uuidv7().slice(-8)}@example.test`,
    },
    { kind: "system" },
  );
  const session = await loginAs(ctx, `uit-lid-${uuidv7().slice(-8)}@example.test`, {
    name: "Uit lid",
  });
  await ctx.t.db
    .insert(workingGroupMemberships)
    .values({ userId: session.userId, workingGroupId: created.id, isCoordinator: false });
  const stream = await openEvents(baseUrl, session.headers);
  try {
    expect(stream.status).toBe(200);
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/working-groups/${created.id}`,
      headers: cast.members.organizationAdmin.headers,
      payload: { active: false },
    });
    expect(res.statusCode).toBe(200);
    expect(await stream.nextEvent()).toEqual({
      event: "access-changed",
      data: { type: "access-changed", userId: session.userId },
    });
  } finally {
    stream.close();
  }
});

test("an admin still lists the members of a group that is off, and makes one coordinator", async () => {
  const created = await createWorkingGroup(
    ctx.t.db,
    {
      organizationId: cast.organization.id,
      name: `Uit ${uuidv7().slice(-8)}`,
      city: "Enschede",
      coordinatorEmail: `uit2-${uuidv7().slice(-8)}@example.test`,
    },
    { kind: "system" },
  );
  const session = await loginAs(ctx, `uit2-lid-${uuidv7().slice(-8)}@example.test`, {
    name: "Uit lid",
  });
  const [row] = await ctx.t.db
    .insert(workingGroupMemberships)
    .values({ userId: session.userId, workingGroupId: created.id, isCoordinator: false })
    .returning({ id: workingGroupMemberships.id });
  const off = await ctx.app.inject({
    method: "PATCH",
    url: `/api/working-groups/${created.id}`,
    headers: cast.members.platformAdmin.headers,
    payload: { active: false },
  });
  expect(off.statusCode).toBe(200);
  for (const who of [cast.members.organizationAdmin, cast.members.platformAdmin]) {
    const res = await list(who, created.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().members).toHaveLength(2);
  }
  const made = await ctx.app.inject({
    method: "PATCH",
    url: `/api/memberships/${row!.id}`,
    headers: cast.members.organizationAdmin.headers,
    payload: { isCoordinator: true },
  });
  expect(made.statusCode).toBe(200);
  expect(made.json()).toMatchObject({ userId: session.userId, isCoordinator: true });
});
