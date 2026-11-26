import { eq } from "drizzle-orm";
import {
  createOrganization,
  createWorkingGroup,
  organizationAdmins,
  workingGroupMemberships,
} from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import type { FastifyInstance } from "fastify";
import { createTestLogger } from "@padvinder/logging/testing";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer, createMemoryMailQueue } from "@padvinder/mail";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import { createCast, type Cast } from "../testing/cast";
import { loginAs, type TestApp } from "../testing/login";

let t: TestDatabase | undefined;
let app: FastifyInstance | undefined;
let ctx: TestApp;
let cast: Cast;
const log = createTestLogger("info");
let mark = 0;
const logLines = () => log.text().split("\n").filter(Boolean).slice(mark);
const clearLog = () => {
  mark = log.text().split("\n").filter(Boolean).length;
};

beforeAll(async () => {
  t = await createTestDatabase();
  const mailer = createMemoryMailer();
  const mailQueue = createMemoryMailQueue();
  app = await buildApp({
    env: testEnv,
    db: t.db,
    notifications: createNoopNotificationHub(),
    mailer,
    queueMail: mailQueue.queueMail,
    logger: log.logger,
  });
  ctx = { app, mailer, mailQueue, t, close: async () => {} };
  cast = await createCast(ctx);
});
afterAll(async () => {
  await app?.close();
  await t?.drop();
});

let applicants = 0;
async function newApplicant(name = "Noor van der Berg") {
  const email = `mail-aanvrager-${applicants++}@example.test`;
  return { email, name, ...(await loginAs(ctx, email, { name })) };
}

/** The mails about requests (not the login codes) sent so far. */
const requestMails = () => ctx.mailer.sent.filter((mail) => !mail.subject.includes("inlogcode"));
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const create = (who: { headers: Record<string, string> }, workingGroupId: string, id = uuidv7()) =>
  ctx.app.inject({
    method: "POST",
    url: "/api/membership-requests",
    headers: who.headers,
    payload: { id, workingGroupId, requestedAt: "2027-01-10T18:00:00+01:00" },
  });
const decide = (who: { headers: Record<string, string> }, id: string, d: "approve" | "reject") =>
  ctx.app.inject({
    method: "POST",
    url: `/api/membership-requests/${id}/${d}`,
    headers: who.headers,
  });

test("a new request mails every coordinator of the group, once", async () => {
  // A second coordinator, next to the cast's.
  const second = await newApplicant("Tweede Coördinator");
  await t!.db.insert(workingGroupMemberships).values({
    userId: second.userId,
    workingGroupId: cast.workingGroup.workingGroupId,
    isCoordinator: true,
  });
  const before = requestMails().length;
  const applicant = await newApplicant();
  const res = await create(applicant, cast.workingGroup.workingGroupId);
  expect(res.statusCode).toBe(201);
  await expect.poll(() => requestMails().length - before).toBe(2);
  const mails = requestMails().slice(before);
  expect(mails.map((mail) => mail.to).sort()).toEqual(
    [cast.members.coordinator.email, second.email].sort(),
  );
  for (const mail of mails) {
    // Each coordinator is greeted by their own name.
    const name = mail.to === second.email ? "Tweede Coördinator" : "Cast coordinator";
    expect(mail.text.startsWith(`Hallo ${name},\n\n`)).toBe(true);
    expect(mail.subject).toBe("Nieuwe aanmelding bij Cast Werkgroep");
    expect(mail.text).toContain("Noor van der Berg wil meedoen met werkgroep Cast Werkgroep.");
    expect(mail.text).toContain(
      `${testEnv.PUBLIC_ORIGIN}/app/more/membership-requests/${(res.json() as { id: string }).id}`,
    );
    // The name is the only personal data: no address, no phone number.
    expect(mail.text).not.toContain(applicant.email);
    expect(mail.html).not.toContain(applicant.email);
  }
});

test("without a coordinator it mails the organization's admins", async () => {
  const group = await createWorkingGroup(
    t!.db,
    {
      organizationId: cast.organization.id,
      name: "Zonder coördinator",
      city: "Enschede",
      coordinatorEmail: "zonder-coordinator@example.test",
    },
    { kind: "system" },
  );
  // Data from before every active working group had a coordinator: the row is removed by hand.
  await t!.db
    .delete(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, group.id));
  const before = requestMails().length;
  const res = await create(await newApplicant(), group.id);
  expect(res.statusCode).toBe(201);
  await expect.poll(() => requestMails().length - before).toBe(2);
  const sent = requestMails().slice(before);
  expect(sent.map((mail) => mail.to).sort()).toEqual(
    [
      cast.members.organizationAdmin.email.toLowerCase(),
      cast.members.organizationAdminUnconfirmed.email.toLowerCase(),
    ].sort(),
  );
  for (const mail of sent) expect(mail.subject).toBe("Nieuwe aanmelding bij Zonder coördinator");
});

test("without a coordinator and without an admin it mails nobody and logs the group's ID", async () => {
  const system = { kind: "system" } as const;
  const organization = await createOrganization(
    t!.db,
    { name: "Zonder beheer", adminEmail: "zonder-beheer@example.test" },
    system,
  );
  // Data from before every organization had an admin: the row is removed by hand.
  await t!.db
    .delete(organizationAdmins)
    .where(eq(organizationAdmins.organizationId, organization.id));
  const group = await createWorkingGroup(
    t!.db,
    {
      organizationId: organization.id,
      name: "Verlaten",
      city: "Nergensdorp",
      coordinatorEmail: "verlaten-coordinator@example.test",
    },
    system,
  );
  // Data from before every active working group had a coordinator: the row is removed by hand.
  await t!.db
    .delete(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, group.id));
  const name = "Eenzame Aanvrager";
  const applicant = await newApplicant(name);
  clearLog();
  const before = requestMails().length;
  expect((await create(applicant, group.id)).statusCode).toBe(201);
  await expect.poll(() => logLines().join("")).toContain("nobody to mail");
  const line = logLines().find((entry) => entry.includes("nobody to mail"))!;
  expect(JSON.parse(line)).toMatchObject({
    level: "warn",
    mailKind: "new-request",
    workingGroupId: group.id,
  });
  expect(line).not.toContain("example.test");
  expect(line).not.toContain("Eenzame");
  await settle();
  expect(requestMails().length).toBe(before);
});

test("an applicant without a name is called Iemand in the mail", async () => {
  const before = requestMails().length;
  const res = await create(await newApplicant(""), cast.otherGroup.workingGroupId);
  expect(res.statusCode).toBe(201);
  await expect.poll(() => requestMails().length - before).toBe(1);
  expect(requestMails().at(-1)!.text).toContain(
    "Iemand wil meedoen met werkgroep Cast Andere werkgroep.",
  );
});

test("a resend of the same id sends no second mail", async () => {
  const applicant = await newApplicant();
  const id = uuidv7();
  const before = requestMails().length;
  expect((await create(applicant, cast.workingGroup.workingGroupId, id)).statusCode).toBe(201);
  await expect.poll(() => requestMails().length - before).toBeGreaterThan(0);
  const afterFirst = requestMails().length;
  expect((await create(applicant, cast.workingGroup.workingGroupId, id)).statusCode).toBe(200);
  // A refused request (a conflict) sends nothing either.
  expect((await create(applicant, cast.workingGroup.workingGroupId)).statusCode).toBe(409);
  await settle();
  expect(requestMails().length).toBe(afterFirst);
});

test("approval mails the applicant; the same approval again does not", async () => {
  const applicant = await newApplicant();
  const id = ((await create(applicant, cast.workingGroup.workingGroupId)).json() as { id: string })
    .id;
  await settle();
  const before = requestMails().length;
  expect((await decide(cast.members.coordinator, id, "approve")).statusCode).toBe(200);
  await expect.poll(() => requestMails().length - before).toBe(1);
  const mail = requestMails().at(-1)!;
  expect(mail.to).toBe(applicant.email);
  expect(mail.subject).toBe("Je bent toegelaten tot werkgroep Cast Werkgroep");
  expect(mail.text).toContain(`${testEnv.PUBLIC_ORIGIN}/app/`);
  // The applicant is greeted by name; the name is the only personal data in the mail.
  expect(mail.text.startsWith("Hallo Noor van der Berg,\n\n")).toBe(true);
  expect((await decide(cast.members.coordinator, id, "approve")).statusCode).toBe(200);
  // The opposite decision is refused and sends nothing.
  expect((await decide(cast.members.coordinator, id, "reject")).statusCode).toBe(409);
  await settle();
  expect(requestMails().length).toBe(before + 1);
});

test("rejection mails the applicant, and only a decision mails them", async () => {
  const applicant = await newApplicant();
  const id = ((await create(applicant, cast.workingGroup.workingGroupId)).json() as { id: string })
    .id;
  await settle();
  // Reading the request, or a forbidden decision, sends nothing.
  const before = requestMails().length;
  await ctx.app.inject({
    url: `/api/membership-requests/${id}`,
    headers: cast.members.coordinator.headers,
  });
  expect((await decide(cast.members.volunteer, id, "reject")).statusCode).toBe(403);
  await settle();
  expect(requestMails().length).toBe(before);

  expect((await decide(cast.members.coordinator, id, "reject")).statusCode).toBe(200);
  await expect.poll(() => requestMails().length - before).toBe(1);
  const mail = requestMails().at(-1)!;
  expect(mail.to).toBe(applicant.email);
  expect(mail.subject).toBe("Je aanmelding bij werkgroep Cast Werkgroep");
  expect(mail.text).toContain("is niet goedgekeurd");
  expect((await decide(cast.members.coordinator, id, "reject")).statusCode).toBe(200);
  await settle();
  expect(requestMails().length).toBe(before + 1);
});

test("a failing mailer does not fail the request or the decision", async () => {
  const applicant = await newApplicant();
  ctx.mailer.failWith(new Error("smtp down"));
  try {
    const created = await create(applicant, cast.workingGroup.workingGroupId);
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    expect((await decide(cast.members.coordinator, id, "approve")).statusCode).toBe(200);
  } finally {
    ctx.mailer.failWith(null);
  }
});

test("the failure log holds no address and no name", async () => {
  const name = "Geheime Naam Jansen";
  const applicant = await newApplicant(name);
  clearLog();
  ctx.mailer.failWith(
    new Error(`rejected ${applicant.email} ${name} ${cast.members.coordinator.email}`),
  );
  try {
    const created = await create(applicant, cast.workingGroup.workingGroupId);
    const id = (created.json() as { id: string }).id;
    await decide(cast.members.coordinator, id, "reject");
    await expect.poll(() => logLines().join("")).toContain("new-request");
    await expect.poll(() => logLines().join("")).toContain('"mailKind":"rejected"');
  } finally {
    ctx.mailer.failWith(null);
  }
  const log = logLines().join("");
  expect(log).not.toContain("example.test");
  expect(log).not.toContain("Geheime");
  expect(log).not.toContain("Jansen");
});
