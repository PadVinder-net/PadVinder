import { afterAll, beforeAll, expect, test } from "vitest";
import { createCast, expectStatuses, type Cast, type CastLogin } from "../testing/cast";
import { createTestApp, type TestApp } from "../testing/login";

let ctx: TestApp;
let cast: Cast;
beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);
});
afterAll(() => ctx.close());

const get = (member: CastLogin) =>
  ctx.app.inject({ url: "/api/working-groups", headers: member.headers });

test("everyone logged in gets the list, nobody else", async () =>
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
    (headers) => ctx.app.inject({ url: "/api/working-groups", headers }),
  ));

test("a row holds exactly id, name, city and the organization's id and name", async () => {
  const [row] = (await get(cast.members.applicant)).json().workingGroups;
  expect(Object.keys(row).sort()).toEqual(["city", "id", "name", "organization"]);
  expect(Object.keys(row.organization).sort()).toEqual(["id", "name"]);
});

test("the list includes groups of other organizations", async () => {
  const ids = (await get(cast.members.volunteer))
    .json()
    .workingGroups.map((g: { id: string }) => g.id);
  expect(ids).toContain(cast.workingGroup.workingGroupId);
  expect(ids).toContain(cast.foreignGroup.workingGroupId);
});
