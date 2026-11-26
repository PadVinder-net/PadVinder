import { getAccess, getOrganization, listMembers, users } from "@padvinder/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  type Cast,
  type CastMember,
  createCast,
  expectStatuses,
  OTHER_GROUP_COORDINATOR_EMAIL,
} from "./cast";
import { createTestApp, type TestApp } from "./login";

let ctx: TestApp;
let cast: Cast;

beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);
});
afterAll(async () => {
  await ctx?.close();
});

test("the cast has the roles it says", async () => {
  const access = (who: CastMember) => getAccess(ctx.t.db, cast.members[who].userId);
  expect((await access("platformAdmin"))?.isPlatformAdmin).toBe(true);
  expect((await access("organizationAdmin"))?.adminOfOrganizationIds).toEqual([
    cast.organization.id,
  ]);
  expect((await access("coordinator"))?.memberships).toMatchObject([
    { workingGroupId: cast.workingGroup.workingGroupId, isCoordinator: true },
  ]);
  expect((await access("volunteer"))?.memberships).toMatchObject([
    { workingGroupId: cast.workingGroup.workingGroupId, isCoordinator: false },
  ]);
  expect((await access("volunteerOtherGroup"))?.memberships).toMatchObject([
    { workingGroupId: cast.otherGroup.workingGroupId, isCoordinator: false },
  ]);
  expect((await access("coordinatorOtherOrganization"))?.memberships).toMatchObject([
    { organizationId: cast.otherOrganization.id, isCoordinator: true },
  ]);
  expect((await access("organizationAdminOtherOrganization"))?.adminOfOrganizationIds).toEqual([
    cast.otherOrganization.id,
  ]);
  expect((await access("organizationAdminOtherOrganization"))?.memberships).toEqual([]);
  expect((await access("applicant"))?.memberships).toEqual([]);
  expect(cast.workingGroup.organizationId).toBe(cast.organization.id);
  expect(cast.otherGroup.organizationId).toBe(cast.organization.id);
  expect(cast.foreignGroup.organizationId).toBe(cast.otherOrganization.id);
});

test("the cast has eight members, and each organization exactly its own admin", async () => {
  expect(Object.keys(cast.members)).toHaveLength(8);
  const admins = async (organizationId: string) =>
    (await getOrganization(ctx.t.db, organizationId))?.admins.map((admin) => admin.userId);
  expect(await admins(cast.organization.id)).toEqual([cast.members.organizationAdmin.userId]);
  expect(await admins(cast.otherOrganization.id)).toEqual([
    cast.members.organizationAdminOtherOrganization.userId,
  ]);
});

test("every working group has its first coordinator; otherGroup's never logged in", async () => {
  const coordinators = async (workingGroupId: string) =>
    (await listMembers(ctx.t.db, workingGroupId, { contact: true }))
      .filter((member) => member.isCoordinator)
      .map((member) => member.email);
  expect(await coordinators(cast.workingGroup.workingGroupId)).toEqual([
    cast.members.coordinator.email.toLowerCase(),
  ]);
  expect(await coordinators(cast.foreignGroup.workingGroupId)).toEqual([
    cast.members.coordinatorOtherOrganization.email.toLowerCase(),
  ]);
  expect(await coordinators(cast.otherGroup.workingGroupId)).toEqual([
    OTHER_GROUP_COORDINATOR_EMAIL,
  ]);
  const [other] = await ctx.t.db
    .select()
    .from(users)
    .where(eq(users.email, OTHER_GROUP_COORDINATOR_EMAIL));
  expect(other?.lastLoginAt).toBeNull();
});

test("every member's cookie is a working session", async () => {
  await expectStatuses(
    cast,
    {
      platformAdmin: 200,
      organizationAdmin: 200,
      coordinator: 200,
      volunteer: 200,
      volunteerOtherGroup: 200,
      coordinatorOtherOrganization: 200,
      organizationAdminOtherOrganization: 200,
      applicant: 200,
      anonymous: 401,
    },
    (headers) => ctx.app.inject({ url: "/api/me", headers }),
  );
});

test("expectStatuses names the members whose status differs", async () => {
  const all = {
    platformAdmin: 200,
    organizationAdmin: 200,
    coordinator: 200,
    volunteer: 200,
    volunteerOtherGroup: 200,
    coordinatorOtherOrganization: 200,
    organizationAdminOtherOrganization: 200,
    applicant: 200,
    anonymous: 401,
  };
  const error = await expectStatuses(cast, { ...all, volunteer: 403, anonymous: 200 }, (headers) =>
    ctx.app.inject({ url: "/api/me", headers }),
  ).then(
    () => null,
    (e: unknown) => e as Error,
  );
  expect(error?.message).toContain("volunteer: expected 403, got 200");
  expect(error?.message).toContain("anonymous: expected 200, got 401");
  expect(error?.message).not.toContain("coordinator:");
});

test("the cast's three admins are recently confirmed; nobody else is stamped", async () => {
  const { rows } = await ctx.t.pool.query<{ user_id: string; passkey_verified_at: Date | null }>(
    "select user_id, passkey_verified_at from sessions",
  );
  const stamped = new Set(rows.filter((r) => r.passkey_verified_at).map((r) => r.user_id));
  const admins: CastMember[] = [
    "platformAdmin",
    "organizationAdmin",
    "organizationAdminOtherOrganization",
  ];
  expect(stamped).toEqual(new Set(admins.map((who) => cast.members[who].userId)));
  for (const r of rows.filter((r) => r.passkey_verified_at)) {
    expect(Date.now() - r.passkey_verified_at!.getTime()).toBeLessThan(10 * 60 * 1000);
  }
});
