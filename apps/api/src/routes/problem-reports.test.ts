import { createTestLogger } from "@padvinder/logging/testing";
import { startFakeSentry } from "@padvinder/monitoring/testing";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createCast, expectStatuses, type Cast } from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";
import { testEnv } from "../test-env";

let fake: Awaited<ReturnType<typeof startFakeSentry>>;
let other: Awaited<ReturnType<typeof startFakeSentry>>;
let ctx: TestApp;
let off: TestApp;
let cast: Cast;
const offLog = createTestLogger("info");

beforeAll(async () => {
  fake = await startFakeSentry();
  other = await startFakeSentry();
  ctx = await createTestApp(
    {},
    {
      monitoring: {
        dsn: other.dsn,
        browserDsn: fake.dsn,
        environment: "staging",
        release: "rel-1",
      },
    },
  );
  off = await createTestApp(
    {},
    {
      logger: offLog.logger,
      monitoring: {
        dsn: other.dsn,
        browserDsn: undefined,
        environment: "staging",
        release: "rel-1",
      },
    },
  );
  cast = await createCast(off);
});

afterAll(async () => {
  await ctx?.close();
  await off?.close();
  await fake?.close();
  await other?.close();
});

beforeEach(() => {
  fake.answerWith(200);
});

const report = {
  message: "De knop doet niets",
  includeContact: false,
  page: "/app/more",
  appVersion: "2027.1.0",
  app: "app",
};

function send(app: TestApp, headers: Record<string, string>, body: unknown = report) {
  return app.app.inject({
    method: "POST",
    url: "/api/problem-reports",
    headers: { origin: testEnv.PUBLIC_ORIGIN, ...headers },
    payload: body as object,
  });
}

let personCounter = 0;
/** A fresh account per test, so the limit of one test does not reach another. */
async function newPerson(app: TestApp, name = "Noor de Vries") {
  personCounter += 1;
  const email = `reporter-${personCounter}@example.test`;
  const session = await loginAs(app, email, { name });
  return { ...session, email };
}

function feedbackOf(raw: string) {
  const lines = raw.split("\n");
  expect(JSON.parse(lines[1]!)).toEqual({ type: "feedback" });
  return JSON.parse(lines[2]!) as {
    user: unknown;
    tags: Record<string, string>;
    environment: string;
    release: string;
    contexts: { feedback: Record<string, unknown> };
  };
}

test("every logged-in user may send a report; without a login 401", async () => {
  await expectStatuses(
    cast,
    {
      platformAdmin: 204,
      platformAdminUnconfirmed: 204,
      organizationAdmin: 204,
      organizationAdminUnconfirmed: 204,
      coordinator: 204,
      volunteer: 204,
      volunteerOtherGroup: 204,
      coordinatorOtherOrganization: 204,
      organizationAdminOtherOrganization: 204,
      applicant: 204,
      anonymous: 401,
    },
    (headers) => send(off, headers),
  );
});

test("sends the report to Sentry as feedback, with the user's ID, service, environment and release", async () => {
  const person = await newPerson(ctx);
  const before = fake.bodies().length;
  const res = await send(ctx, person.headers, { ...report, app: "portal", page: "/species" });
  expect(res.statusCode).toBe(204);
  expect(res.body).toBe("");
  const bodies = fake.bodies().slice(before);
  expect(bodies).toHaveLength(1);
  const [header] = fake.envelopes().at(-1)!;
  expect(header.dsn).toBe(fake.dsn);
  const feedback = feedbackOf(bodies[0]!);
  expect(feedback).toMatchObject({
    user: { id: person.userId },
    tags: { service: "portal", app_version: "2027.1.0" },
    environment: "staging",
    release: "rel-1",
    contexts: {
      feedback: { message: "De knop doet niets", url: "/species", source: "padvinder" },
    },
  });
  expect(feedback.user).toEqual({ id: person.userId });
});

test("with includeContact, the name and address come from the profile", async () => {
  const person = await newPerson(ctx, "Anne de Vries");
  const res = await send(ctx, person.headers, { ...report, includeContact: true });
  expect(res.statusCode).toBe(204);
  const feedback = feedbackOf(fake.bodies().at(-1)!);
  expect(feedback.contexts.feedback).toMatchObject({
    name: "Anne de Vries",
    contact_email: person.email,
  });
});

test("without includeContact, neither the name nor the address is sent", async () => {
  const person = await newPerson(ctx, "Anne de Vries");
  const res = await send(ctx, person.headers, { ...report, includeContact: false });
  expect(res.statusCode).toBe(204);
  const raw = fake.bodies().at(-1)!;
  expect(raw).not.toContain(person.email);
  expect(raw).not.toContain("Anne de Vries");
  expect(raw).not.toMatch(/contact_email/);
});

test.each([
  ["email", { email: "spoof@example.test" }],
  ["name", { name: "Iemand Anders" }],
])("a body with an extra %s field is 400 and reaches no Sentry", async (_field, extra) => {
  const person = await newPerson(ctx);
  const before = fake.requests().length;
  const res = await send(ctx, person.headers, { ...report, includeContact: true, ...extra });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ code: "invalid_request" });
  expect(fake.requests()).toHaveLength(before);
});

test("an address in the message is scrubbed", async () => {
  const person = await newPerson(ctx);
  const res = await send(ctx, person.headers, {
    ...report,
    message: "mail me at noor@example.test",
  });
  expect(res.statusCode).toBe(204);
  const raw = fake.bodies().at(-1)!;
  expect(raw).not.toContain("noor@example.test");
  expect(feedbackOf(raw).contexts.feedback.message).toBe("mail me at [email]");
});

test("the crash's event ID arrives as associated_event_id", async () => {
  const person = await newPerson(ctx);
  const eventId = "9ec79c33ec9942ab8353589fcb2e04dc";
  const res = await send(ctx, person.headers, { ...report, eventId });
  expect(res.statusCode).toBe(204);
  expect(feedbackOf(fake.bodies().at(-1)!).contexts.feedback.associated_event_id).toBe(eventId);
});

test("502 report_not_sent when Sentry refuses it", async () => {
  const person = await newPerson(ctx);
  fake.answerWith(500);
  const res = await send(ctx, person.headers);
  expect(res.statusCode).toBe(502);
  expect(res.json()).toMatchObject({ code: "report_not_sent" });
});

test("502 report_not_sent when Sentry cannot be reached", async () => {
  const closed = await startFakeSentry();
  await closed.close();
  const app = await createTestApp(
    {},
    {
      monitoring: {
        dsn: other.dsn,
        browserDsn: closed.dsn,
        environment: "staging",
        release: "rel-1",
      },
    },
  );
  try {
    const person = await newPerson(app);
    const res = await send(app, person.headers);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: "report_not_sent" });
  } finally {
    await app.close();
  }
});

test("the 11th report within an hour by one account is 429; another account still gets through", async () => {
  const person = await newPerson(ctx);
  for (let i = 0; i < 10; i++) {
    expect((await send(ctx, person.headers)).statusCode).toBe(204);
  }
  const before = fake.requests().length;
  const refused = await send(ctx, person.headers);
  expect(refused.statusCode).toBe(429);
  expect(refused.json()).toMatchObject({ code: "too_many_reports" });
  expect(fake.requests()).toHaveLength(before);
  const other = await newPerson(ctx);
  expect((await send(ctx, other.headers)).statusCode).toBe(204);
});

test("with Sentry off: 204 and one info line with the message's length, not its text", async () => {
  const person = await newPerson(off);
  const message = "Het scherm blijft wit MARKER-TEXT";
  const before = offLog.entries().length;
  const res = await send(off, person.headers, { ...report, message });
  expect(res.statusCode).toBe(204);
  const entries = offLog.entries().slice(before);
  const lines = entries.filter((entry) => entry.messageLength !== undefined);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ level: "info", messageLength: message.length });
  expect(JSON.stringify(entries)).not.toContain("MARKER-TEXT");
});

test("a report reaches the browser project's server only", async () => {
  const person = await newPerson(ctx);
  const before = fake.requests().length;
  const res = await send(ctx, person.headers);
  expect(res.statusCode).toBe(204);
  expect(fake.requests().length).toBe(before + 1);
  expect(other.requests()).toHaveLength(0);
  expect(fake.envelopes().at(-1)![0].dsn).toBe(fake.dsn);
});

test("with only the server DSN set a report is only logged and answers 204", async () => {
  const log = createTestLogger("info");
  const onlyServer = await createTestApp(
    {},
    {
      logger: log.logger,
      monitoring: { dsn: other.dsn, browserDsn: undefined, environment: "staging", release: "r" },
    },
  );
  try {
    const person = await newPerson(onlyServer);
    const res = await send(onlyServer, person.headers);
    expect(res.statusCode).toBe(204);
    expect(other.requests()).toHaveLength(0);
    expect(log.text()).toContain("Sentry is off");
  } finally {
    await onlyServer.close();
  }
});

test("a refused report is logged with Sentry's status and its reason, scrubbed", async () => {
  const log = createTestLogger("info");
  const logged = await createTestApp(
    {},
    {
      logger: log.logger,
      monitoring: { dsn: other.dsn, browserDsn: fake.dsn, environment: "staging", release: "r" },
    },
  );
  try {
    const person = await newPerson(logged);
    fake.answerWith(
      403,
      {},
      '{"detail":"event submission rejected with_reason: ProjectId","to":"noor@example.test"}',
    );
    expect((await send(logged, person.headers)).statusCode).toBe(502);
    const line = log
      .entries()
      .find((entry) => entry.msg === "Sentry did not take a problem report");
    expect(line).toMatchObject({ level: "warn", sentryStatus: 403 });
    expect(line?.sentryAnswer).toContain("with_reason: ProjectId");
    expect(log.text()).not.toContain("noor@example.test");
  } finally {
    await logged.close();
  }
});
