import { afterAll, beforeAll, expect, test } from "vitest";
import { createCast, expectStatuses, type Cast } from "../testing/cast";
import { createTestApp, type TestApp } from "../testing/login";

let ctx: TestApp;
let cast: Cast;
beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);
});
afterAll(() => ctx.close());

const triggerTestError = (headers: Record<string, string>) =>
  ctx.app.inject({ method: "POST", url: "/api/system/test-error", headers });

test("only a platform admin triggers the test error; it answers 500 internal_error", async () => {
  await expectStatuses(
    cast,
    {
      platformAdmin: 500,
      organizationAdmin: 403,
      coordinator: 403,
      volunteer: 403,
      volunteerOtherGroup: 403,
      coordinatorOtherOrganization: 403,
      organizationAdminOtherOrganization: 403,
      applicant: 403,
      anonymous: 401,
    },
    triggerTestError,
  );
});

test("the answers carry the stable error codes", async () => {
  const asAdmin = await triggerTestError(cast.members.platformAdmin.headers);
  expect(asAdmin.json()).toMatchObject({ statusCode: 500, code: "internal_error" });
  // The developer message of the thrown error stays in the log and in Sentry.
  expect(asAdmin.body).not.toContain("Test error requested");
  const asVolunteer = await triggerTestError(cast.members.volunteer.headers);
  expect(asVolunteer.json()).toMatchObject({ statusCode: 403, code: "not_allowed" });
  const anonymous = await triggerTestError({});
  expect(anonymous.json()).toMatchObject({ statusCode: 401, code: "not_logged_in" });
});
