import { getAccess } from "@padvinder/db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type Cast, type CastMember, createCast, expectStatuses } from "./cast";
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
  expect((await access("applicant"))?.memberships).toEqual([]);
  expect(cast.workingGroup.organizationId).toBe(cast.organization.id);
  expect(cast.otherGroup.organizationId).toBe(cast.organization.id);
  expect(cast.foreignGroup.organizationId).toBe(cast.otherOrganization.id);
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
