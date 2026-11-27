import { grantPlatformAdmin } from "@padvinder/db";
import { createTestLogger } from "@padvinder/logging/testing";
import { startFakeSentry } from "@padvinder/monitoring/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createCast, expectStatuses, type Cast } from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";

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

describe("POST /api/system/sentry-connection-test", () => {
  let fake: Awaited<ReturnType<typeof startFakeSentry>>;
  let on: TestApp;
  let adminHeaders: Record<string, string>;
  const log = createTestLogger("debug");
  beforeAll(async () => {
    fake = await startFakeSentry();
    on = await createTestApp(
      {},
      {
        logger: log.logger,
        monitoring: {
          dsn: fake.dsn,
          browserDsn: undefined,
          environment: "staging",
          release: "rel-1",
        },
      },
    );
  });
  afterAll(async () => {
    await on?.close();
    await fake?.close();
  });
  beforeEach(() => fake.answerWith(200));

  const testConnection = (app: TestApp, headers: Record<string, string>) =>
    app.app.inject({ method: "POST", url: "/api/system/sentry-connection-test", headers });

  test("only a platform admin runs it", async () => {
    await expectStatuses(
      cast,
      {
        platformAdmin: 200,
        organizationAdmin: 403,
        coordinator: 403,
        volunteer: 403,
        volunteerOtherGroup: 403,
        coordinatorOtherOrganization: 403,
        organizationAdminOtherOrganization: 403,
        applicant: 403,
        anonymous: 401,
      },
      (headers) => testConnection(ctx, headers),
    );
    const refused = await testConnection(ctx, cast.members.volunteer.headers);
    expect(refused.json()).toMatchObject({ statusCode: 403, code: "not_allowed" });
  });

  test("without SENTRY_DSN it says Sentry is off and sends nothing", async () => {
    const response = await testConnection(ctx, cast.members.platformAdmin.headers);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sentryOff: true, results: [] });
  });

  test("with SENTRY_DSN it tries IPv4 and IPv6, and the answer holds no DSN or key", async () => {
    const { headers } = await loginAs(on, "hoofdbeheerder-sentry@example.test");
    await grantPlatformAdmin(
      on.t.db,
      { email: "hoofdbeheerder-sentry@example.test" },
      { kind: "system" },
    );
    adminHeaders = headers;
    const before = fake.events().length;
    const response = await testConnection(on, headers);
    expect(response.statusCode).toBe(200);
    const body = response.json<{ sentryOff: boolean; results: { family: number }[] }>();
    expect(body.sentryOff).toBe(false);
    expect(body.results.map((result) => result.family)).toEqual([4, 6]);
    // The fake listens on 127.0.0.1, which IPv4 reaches.
    expect(body.results[0]).toEqual({ family: 4, status: 200 });
    expect(fake.events().slice(before)).toContainEqual(
      expect.objectContaining({
        message: "Sentry connection test over IPv4",
        tags: { service: "api" },
      }),
    );
    expect(response.body).not.toContain(fake.dsn);
    expect(response.body).not.toContain("public");
  });

  test("the test events carry the server's environment and release", async () => {
    const before = fake.events().length;
    await testConnection(on, adminHeaders);
    const events = fake.events().slice(before);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event).toMatchObject({ environment: "staging", release: "rel-1" });
    }
  });

  const connectionLines = () =>
    log.entries().filter((entry) => entry.msg === "Sentry connection test");

  test("a test that arrives is logged at debug, a refusal at warn, never with the DSN", async () => {
    const before = connectionLines().length;
    await testConnection(on, adminHeaders);
    expect(
      connectionLines()
        .slice(before)
        .map((entry) => entry.level),
    ).toEqual(["debug"]);
    fake.answerWith(403, {}, "<title>403 Forbidden</title>");
    const refused = await testConnection(on, adminHeaders);
    expect(refused.json()).toMatchObject({
      results: [{ family: 4, status: 403, answer: "403 Forbidden" }, { family: 6 }],
    });
    const lines = connectionLines().slice(before + 1);
    expect(lines.map((entry) => entry.level)).toEqual(["warn"]);
    expect(lines[0]).toMatchObject({
      sentryConnection: [{ family: 4, status: 403, answer: "403 Forbidden" }, { family: 6 }],
    });
    expect(log.text()).not.toContain(fake.dsn);
    expect(log.text()).not.toContain("sentry_key");
  });
});
