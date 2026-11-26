import {
  auditLogEntries,
  createWorkingGroup,
  workingGroupMemberships,
  type Db,
} from "@padvinder/db";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createCast,
  expectStatuses,
  type Cast,
  type CastLogin,
  type ExpectedStatuses,
} from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";

let ctx: TestApp;
let cast: Cast;
let db: Db;
beforeAll(async () => {
  ctx = await createTestApp();
  db = ctx.t.db;
  cast = await createCast(ctx);
});
afterAll(() => ctx.close());

type Who = { headers: Record<string, string> };
const send = (who: Who, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: who.headers, payload });
const system = { kind: "system" } as const;

let n = 0;
const uniqueName = () => `Testgroep ${++n} ${uuidv7().slice(-8)}`;
const uniqueAddress = (label: string) => `${label}-${++n}-${uuidv7().slice(-8)}@example.test`;
const createBody = (extra: Record<string, unknown> = {}) => ({
  name: uniqueName(),
  city: "Enschede",
  coordinatorEmail: uniqueAddress("eerste"),
  ...extra,
});
const postGroup = (who: Who, organizationId: string, payload: object) =>
  send(who, "POST", `/api/organizations/${organizationId}/working-groups`, payload);
const patchGroup = (who: Who, id: string, payload: object) =>
  send(who, "PATCH", `/api/working-groups/${id}`, payload);
const patchMembership = (who: Who, id: string, payload: object) =>
  send(who, "PATCH", `/api/memberships/${id}`, payload);

/** A fresh group of the cast's organization, with a coordinator who never logs in. */
async function freshGroup() {
  const created = await createWorkingGroup(
    db,
    {
      organizationId: cast.organization.id,
      name: uniqueName(),
      city: "Enschede",
      coordinatorEmail: uniqueAddress("coordinator"),
    },
    system,
  );
  return created;
}
const membershipOf = async (userId: string, workingGroupId: string) => {
  const [row] = await db
    .select()
    .from(workingGroupMemberships)
    .where(
      and(
        eq(workingGroupMemberships.userId, userId),
        eq(workingGroupMemberships.workingGroupId, workingGroupId),
      ),
    );
  return row!;
};
const entriesFor = (subjectId: string, action: string) =>
  db
    .select()
    .from(auditLogEntries)
    .where(and(eq(auditLogEntries.subjectId, subjectId), eq(auditLogEntries.action, action)));

const managersOfGroup = (ok: number): ExpectedStatuses => ({
  platformAdmin: ok,
  platformAdminUnconfirmed: "passkey_required",
  organizationAdmin: ok,
  organizationAdminUnconfirmed: "passkey_required",
  coordinator: 403,
  volunteer: 403,
  volunteerOtherGroup: 404,
  coordinatorOtherOrganization: 404,
  organizationAdminOtherOrganization: 404,
  applicant: 404,
  anonymous: 401,
});

test("everyone logged in gets their own list", async () =>
  await expectStatuses(
    cast,
    {
      platformAdmin: 200,
      platformAdminUnconfirmed: 200,
      organizationAdmin: 200,
      organizationAdminUnconfirmed: 200,
      coordinator: 200,
      volunteer: 200,
      volunteerOtherGroup: 200,
      coordinatorOtherOrganization: 200,
      organizationAdminOtherOrganization: 200,
      applicant: 200,
      anonymous: 401,
    },
    (headers) => ctx.app.inject({ url: "/api/managed-working-groups", headers }),
  ));

test("the list: all groups for the platform admin, the organization's for its admin, the coordinated one for the coordinator, none for a volunteer", async () => {
  const ids = async (who: CastLogin) =>
    (
      (await send(who, "GET", "/api/managed-working-groups")).json().workingGroups as {
        id: string;
      }[]
    ).map((g) => g.id);
  const mine = cast.workingGroup.workingGroupId;
  const other = cast.otherGroup.workingGroupId;
  const foreign = cast.foreignGroup.workingGroupId;
  expect(await ids(cast.members.platformAdmin)).toEqual(
    expect.arrayContaining([mine, other, foreign]),
  );
  const admin = await ids(cast.members.organizationAdmin);
  expect(admin).toContain(mine);
  expect(admin).toContain(other);
  expect(admin).not.toContain(foreign);
  expect(await ids(cast.members.coordinator)).toEqual([mine]);
  expect(await ids(cast.members.volunteer)).toEqual([]);
  expect(await ids(cast.members.applicant)).toEqual([]);
  const row = (await send(cast.members.coordinator, "GET", "/api/managed-working-groups")).json()
    .workingGroups[0];
  expect(Object.keys(row).sort()).toEqual([
    "active",
    "city",
    "id",
    "memberCount",
    "name",
    "organization",
    "pendingRequestCount",
  ]);
});

test("only the organization's admins and platform admins create a working group", async () =>
  await expectStatuses(
    cast,
    {
      platformAdmin: 201,
      platformAdminUnconfirmed: "passkey_required",
      organizationAdmin: 201,
      organizationAdminUnconfirmed: "passkey_required",
      coordinator: 404,
      volunteer: 404,
      volunteerOtherGroup: 404,
      coordinatorOtherOrganization: 404,
      organizationAdminOtherOrganization: 404,
      applicant: 404,
      anonymous: 401,
    },
    (headers) => postGroup({ headers }, cast.organization.id, createBody()),
  ));

test("only they change a working group", async () =>
  await expectStatuses(cast, managersOfGroup(200), (headers) =>
    patchGroup({ headers }, cast.workingGroup.workingGroupId, { city: "Enschede" }),
  ));

test("only they make a member coordinator", async () => {
  const volunteer = await membershipOf(
    cast.members.volunteer.userId,
    cast.workingGroup.workingGroupId,
  );
  await expectStatuses(cast, managersOfGroup(200), (headers) =>
    patchMembership({ headers }, volunteer.id, { isCoordinator: false }),
  );
});

test("creating makes the first coordinator; the answer counts one member", async () => {
  const body = createBody();
  const res = await postGroup(cast.members.organizationAdmin, cast.organization.id, body);
  expect(res.statusCode).toBe(201);
  expect(res.json()).toEqual({
    id: expect.any(String),
    name: body.name,
    city: "Enschede",
    active: true,
    organization: { id: cast.organization.id, name: "Cast Organisatie" },
    memberCount: 1,
    pendingRequestCount: 0,
  });
  const [coordinator] = await db
    .select()
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, res.json().id));
  expect(coordinator).toMatchObject({ isCoordinator: true });
});

test("naming someone with a profile outside the organization is 409 on coordinatorEmail, and the answer holds no name or phone number", async () => {
  const res = await postGroup(
    cast.members.organizationAdmin,
    cast.organization.id,
    createBody({ coordinatorEmail: cast.members.coordinatorOtherOrganization.email }),
  );
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({
    code: "person_outside_organization",
    issues: [{ path: "coordinatorEmail" }],
  });
  expect(res.body).not.toContain("Cast coordinatorOtherOrganization");
  expect(res.body).not.toContain("phone");
});

test("the creator may name themself", async () => {
  const res = await postGroup(
    cast.members.organizationAdmin,
    cast.organization.id,
    createBody({ coordinatorEmail: cast.members.organizationAdmin.email }),
  );
  expect(res.statusCode).toBe(201);
});

test("a taken name is 409 name_taken on name", async () => {
  const body = createBody();
  expect((await postGroup(cast.members.platformAdmin, cast.organization.id, body)).statusCode).toBe(
    201,
  );
  const again = await postGroup(
    cast.members.platformAdmin,
    cast.organization.id,
    createBody({ name: ` ${body.name.toUpperCase()} ` }),
  );
  expect(again.statusCode).toBe(409);
  expect(again.json()).toMatchObject({ code: "name_taken", issues: [{ path: "name" }] });
  const rename = await patchGroup(cast.members.platformAdmin, cast.workingGroup.workingGroupId, {
    name: body.name,
  });
  expect(rename.statusCode).toBe(409);
  expect(rename.json()).toMatchObject({ code: "name_taken" });
});

test("switching off takes the group out of a member's /api/me, and switching on brings it back", async () => {
  const group = await freshGroup();
  const member = await loginAs(ctx, uniqueAddress("lid"), { name: "Lid" });
  await db
    .insert(workingGroupMemberships)
    .values({ userId: member.userId, workingGroupId: group.id, isCoordinator: false });
  const groups = async () =>
    (
      (await send(member, "GET", "/api/me")).json().memberships as {
        workingGroup: { id: string };
      }[]
    ).map((m) => m.workingGroup.id);
  expect(await groups()).toEqual([group.id]);
  const off = await patchGroup(cast.members.organizationAdmin, group.id, { active: false });
  expect(off.statusCode).toBe(200);
  expect(off.json().active).toBe(false);
  expect(await groups()).toEqual([]);
  const on = await patchGroup(cast.members.organizationAdmin, group.id, { active: true });
  expect(on.statusCode).toBe(200);
  expect(await groups()).toEqual([group.id]);
});

test("switching on a group without a coordinator is 409 no_coordinator", async () => {
  const group = await freshGroup();
  expect(
    (await patchGroup(cast.members.platformAdmin, group.id, { active: false })).statusCode,
  ).toBe(200);
  await db
    .delete(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, group.id));
  const res = await patchGroup(cast.members.platformAdmin, group.id, { active: true });
  expect(res.statusCode).toBe(409);
  expect(res.json().code).toBe("no_coordinator");
});

test("clearing the flag of the last coordinator is 409 last_coordinator; with a second coordinator it is 200", async () => {
  const group = await freshGroup();
  const [first] = await db
    .select()
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, group.id));
  const refused = await patchMembership(cast.members.platformAdmin, first!.id, {
    isCoordinator: false,
  });
  expect(refused.statusCode).toBe(409);
  expect(refused.json().code).toBe("last_coordinator");
  const second = await loginAs(ctx, uniqueAddress("tweede"), { name: "Tweede" });
  const [row] = await db
    .insert(workingGroupMemberships)
    .values({ userId: second.userId, workingGroupId: group.id, isCoordinator: false })
    .returning({ id: workingGroupMemberships.id });
  expect(
    (await patchMembership(cast.members.platformAdmin, row!.id, { isCoordinator: true }))
      .statusCode,
  ).toBe(200);
  const cleared = await patchMembership(cast.members.platformAdmin, first!.id, {
    isCoordinator: false,
  });
  expect(cleared.statusCode).toBe(200);
  expect(cleared.json()).toMatchObject({ membershipId: first!.id, isCoordinator: false });
});

test("the same PATCH twice answers 200 twice and writes one entry", async () => {
  const group = await freshGroup();
  const member = await loginAs(ctx, uniqueAddress("lid"), { name: "Lid" });
  const [row] = await db
    .insert(workingGroupMemberships)
    .values({ userId: member.userId, workingGroupId: group.id, isCoordinator: false })
    .returning({ id: workingGroupMemberships.id });
  for (let i = 0; i < 2; i++) {
    expect(
      (await patchMembership(cast.members.organizationAdmin, row!.id, { isCoordinator: true }))
        .statusCode,
    ).toBe(200);
  }
  expect(await entriesFor(member.userId, "role.coordinator_granted")).toHaveLength(1);
  for (let i = 0; i < 2; i++) {
    expect(
      (await patchGroup(cast.members.organizationAdmin, group.id, { city: "Hengelo" })).statusCode,
    ).toBe(200);
  }
  expect(await entriesFor(group.id, "working_group.updated")).toHaveLength(1);
});

test("the audit entry of a role change names the admin as actor and the working group in its details", async () => {
  const group = await freshGroup();
  const member = await loginAs(ctx, uniqueAddress("lid"), { name: "Lid" });
  const [row] = await db
    .insert(workingGroupMemberships)
    .values({ userId: member.userId, workingGroupId: group.id, isCoordinator: false })
    .returning({ id: workingGroupMemberships.id });
  await patchMembership(cast.members.organizationAdmin, row!.id, { isCoordinator: true });
  const [entry] = await entriesFor(member.userId, "role.coordinator_granted");
  expect(entry).toMatchObject({
    actorUserId: cast.members.organizationAdmin.userId,
    organizationId: cast.organization.id,
    details: { workingGroupId: group.id },
  });
});

test("the answer of a membership change holds contact details", async () => {
  const volunteer = await membershipOf(
    cast.members.volunteer.userId,
    cast.workingGroup.workingGroupId,
  );
  const res = await patchMembership(cast.members.platformAdmin, volunteer.id, {
    isCoordinator: false,
  });
  expect(res.json()).toMatchObject({
    membershipId: volunteer.id,
    userId: cast.members.volunteer.userId,
    email: cast.members.volunteer.email,
    hasLoggedIn: true,
  });
});

test("an unknown working group or membership is 404; an empty body and an unknown key are 400", async () => {
  const admin = cast.members.platformAdmin;
  expect((await patchGroup(admin, uuidv7(), { city: "X" })).statusCode).toBe(404);
  expect((await patchMembership(admin, uuidv7(), { isCoordinator: true })).statusCode).toBe(404);
  expect((await postGroup(admin, uuidv7(), createBody())).statusCode).toBe(404);
  const id = cast.workingGroup.workingGroupId;
  expect((await patchGroup(admin, id, {})).statusCode).toBe(400);
  expect((await patchGroup(admin, id, { color: "red" })).statusCode).toBe(400);
  expect((await patchGroup(admin, id, { name: "a@b" })).statusCode).toBe(400);
  const volunteer = await membershipOf(cast.members.volunteer.userId, id);
  expect((await patchMembership(admin, volunteer.id, {})).statusCode).toBe(400);
  expect(
    (await patchMembership(admin, volunteer.id, { isCoordinator: true, x: 1 })).statusCode,
  ).toBe(400);
});

test("the list everyone chooses from still holds exactly id, name, city and organization", async () => {
  const res = await send(cast.members.applicant, "GET", "/api/working-groups");
  for (const group of res.json().workingGroups) {
    expect(Object.keys(group).sort()).toEqual(["city", "id", "name", "organization"]);
  }
});
