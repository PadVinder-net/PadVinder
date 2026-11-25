import {
  auditLogEntries,
  createMembershipRequest,
  liveEventsChannel,
  membershipRequests,
  users,
  workingGroupMemberships,
} from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer, createMemoryMailQueue } from "@padvinder/mail";
import { startNotificationHub, type NotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import { openEvents } from "../test-open-events";
import { createCast, expectStatuses, type Cast } from "../testing/cast";
import { loginAs, type TestApp } from "../testing/login";

// A real notification hub, so a test can read the live events from the stream.
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
  const mailQueue = createMemoryMailQueue();
  app = await buildApp({
    env: testEnv,
    db: t.db,
    notifications: hub,
    mailer,
    queueMail: mailQueue.queueMail,
  });
  ctx = { app, mailer, mailQueue, t, close: async () => {} };
  cast = await createCast(ctx);
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await app?.close();
  await hub?.close();
  await t?.drop();
});

type Who = { headers: Record<string, string> };

const reviewers = {
  platformAdmin: 200,
  organizationAdmin: 200,
  coordinator: 200,
  volunteer: 403,
  volunteerOtherGroup: 404,
  coordinatorOtherOrganization: 404,
  organizationAdminOtherOrganization: 404,
  applicant: 404,
  anonymous: 401,
};

let applicants = 0;
/** A user who is not logged in, with a name, an email address and a phone number. */
async function newApplicant(phone: string | null = "06 12345678") {
  const n = applicants++;
  const profile = { name: `Noor ${n}`, email: `aanvrager-${n}@example.test`, phone };
  const [row] = await ctx.t.db
    .insert(users)
    .values({ ...profile, emailVerified: true })
    .returning({ id: users.id });
  return { id: row!.id, ...profile };
}

/** A fresh applicant with a fresh pending request; returns the request's id. */
async function freshRequest(
  workingGroupId = cast.workingGroup.workingGroupId,
  applicant?: { id: string },
  now = new Date(),
): Promise<string> {
  const userId = (applicant ?? (await newApplicant())).id;
  const id = uuidv7();
  const result = await createMembershipRequest(ctx.t.db, {
    id,
    userId,
    workingGroupId,
    requestedAt: new Date("2027-01-10T18:00:00Z"),
    now,
  });
  if (result.outcome !== "created") throw new Error(`Expected created, got ${result.outcome}`);
  return id;
}

const list = (who: Who, workingGroupId = cast.workingGroup.workingGroupId) =>
  ctx.app.inject({
    url: `/api/working-groups/${workingGroupId}/membership-requests`,
    headers: who.headers,
  });
const getOne = (who: Who, id: string) =>
  ctx.app.inject({ url: `/api/membership-requests/${id}`, headers: who.headers });
const decide = (who: Who, id: string, decision: "approve" | "reject") =>
  ctx.app.inject({
    method: "POST",
    url: `/api/membership-requests/${id}/${decision}`,
    headers: who.headers,
  });
const approve = (who: Who, id: string) => decide(who, id, "approve");
const reject = (who: Who, id: string) => decide(who, id, "reject");

const requestRow = async (id: string) =>
  (await ctx.t.db.select().from(membershipRequests).where(eq(membershipRequests.id, id)))[0]!;
const membershipsOf = (userId: string) =>
  ctx.t.db.select().from(workingGroupMemberships).where(eq(workingGroupMemberships.userId, userId));
const auditOf = (id: string) =>
  ctx.t.db.select().from(auditLogEntries).where(eq(auditLogEntries.subjectId, id));

const castGroup = () => ({
  id: cast.workingGroup.workingGroupId,
  name: "Cast Werkgroep",
  city: "Enschede",
  organization: { id: cast.organization.id, name: "Cast Organisatie" },
});

test("who may list the requests of a group", async () => {
  await expectStatuses(cast, reviewers, (headers) => list({ headers }));
});

test("who may open one request", async () => {
  const id = await freshRequest();
  await expectStatuses(cast, reviewers, (headers) => getOne({ headers }, id));
});

test("who may approve", async () => {
  // Each call gets a fresh applicant with a fresh pending request.
  await expectStatuses(cast, reviewers, async (headers) =>
    approve({ headers }, await freshRequest()),
  );
});

test("who may reject", async () => {
  await expectStatuses(cast, reviewers, async (headers) =>
    reject({ headers }, await freshRequest()),
  );
});

test("the list holds the applicant's name, email address and phone number, oldest first", async () => {
  const group = cast.otherGroup.workingGroupId;
  const first = await newApplicant();
  const second = await newApplicant(null);
  const third = await newApplicant();
  const at = (seconds: number) => new Date(Date.UTC(2027, 0, 10, 18, 0, seconds));
  const secondId = await freshRequest(group, second, at(2));
  const firstId = await freshRequest(group, first, at(1));
  const withdrawnId = await freshRequest(group, third, at(0));
  await ctx.t.db
    .update(membershipRequests)
    .set({ status: "withdrawn", decidedAt: at(3) })
    .where(eq(membershipRequests.id, withdrawnId));

  const res = await list(cast.members.organizationAdmin, group);
  expect(res.statusCode).toBe(200);
  const summary = {
    id: group,
    name: "Cast Andere werkgroep",
    city: "Enschede",
    organization: { id: cast.organization.id, name: "Cast Organisatie" },
  };
  expect(res.json()).toEqual({
    membershipRequests: [
      {
        id: firstId,
        status: "pending",
        requestedAt: "2027-01-10T18:00:00.000Z",
        decidedAt: null,
        workingGroup: summary,
        applicant: { id: first.id, name: first.name, email: first.email, phone: first.phone },
      },
      {
        id: secondId,
        status: "pending",
        requestedAt: "2027-01-10T18:00:00.000Z",
        decidedAt: null,
        workingGroup: summary,
        applicant: { id: second.id, name: second.name, email: second.email, phone: null },
      },
    ],
  });
  // Nothing of the server's bookkeeping leaks.
  expect(res.body).not.toMatch(/receivedAt|userId|organizationId|decidedBy/);
});

test("a pending request opens with its applicant's name, email address and phone number", async () => {
  const applicant = await newApplicant();
  const id = await freshRequest(cast.workingGroup.workingGroupId, applicant);
  const res = await getOne(cast.members.coordinator, id);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    id,
    status: "pending",
    requestedAt: "2027-01-10T18:00:00.000Z",
    decidedAt: null,
    workingGroup: castGroup(),
    applicant: {
      id: applicant.id,
      name: applicant.name,
      email: applicant.email,
      phone: applicant.phone,
    },
  });
  expect(Object.keys(res.json()).sort()).toEqual([
    "applicant",
    "decidedAt",
    "id",
    "requestedAt",
    "status",
    "workingGroup",
  ]);
});

/** The raw answer holds no contact keys and none of the applicant's contact details. */
function expectNoContact(
  res: { body: string; json: () => { applicant: object } },
  applicant: { email: string },
) {
  expect(Object.keys(res.json().applicant).sort()).toEqual(["id", "name"]);
  expect(res.body).not.toMatch(/"email"|"phone"|06 1234/);
  expect(res.body).not.toContain(applicant.email);
}

test("a withdrawn, rejected or approved request opens without the applicant's contact details", async () => {
  for (const status of ["withdrawn", "rejected", "approved"] as const) {
    const applicant = await newApplicant();
    const id = await freshRequest(cast.workingGroup.workingGroupId, applicant);
    if (status === "withdrawn") {
      await ctx.t.db
        .update(membershipRequests)
        .set({ status: "withdrawn", decidedAt: new Date() })
        .where(eq(membershipRequests.id, id));
    } else {
      const decided = await decide(
        cast.members.coordinator,
        id,
        status === "approved" ? "approve" : "reject",
      );
      expect(decided.statusCode).toBe(200);
      expectNoContact(decided, applicant);
    }
    // The same for every reviewer, platform admins included.
    for (const who of [
      cast.members.coordinator,
      cast.members.organizationAdmin,
      cast.members.platformAdmin,
    ]) {
      const res = await getOne(who, id);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id,
        status,
        requestedAt: "2027-01-10T18:00:00.000Z",
        decidedAt: expect.any(String),
        workingGroup: castGroup(),
        applicant: { id: applicant.id, name: applicant.name },
      });
      expectNoContact(res, applicant);
    }
  }
});

test("approving creates a volunteer membership and one audit entry without personal data", async () => {
  const applicant = await newApplicant();
  const id = await freshRequest(cast.workingGroup.workingGroupId, applicant);
  const res = await approve(cast.members.coordinator, id);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({
    id,
    status: "approved",
    decidedAt: expect.any(String),
    applicant: { id: applicant.id, name: applicant.name },
  });
  expectNoContact(res, applicant);
  expect(await membershipsOf(applicant.id)).toMatchObject([
    { workingGroupId: cast.workingGroup.workingGroupId, isCoordinator: false },
  ]);
  const row = await requestRow(id);
  expect(row).toMatchObject({
    status: "approved",
    decidedByUserId: cast.members.coordinator.userId,
  });
  expect(row.decidedAt?.toISOString()).toBe(res.json().decidedAt);
  const entries = await auditOf(id);
  expect(entries).toMatchObject([
    {
      action: "membership_request.approved",
      actorKind: "user",
      actorUserId: cast.members.coordinator.userId,
      organizationId: cast.organization.id,
      subjectType: "membership_request",
      subjectId: id,
      details: { workingGroupId: cast.workingGroup.workingGroupId },
    },
  ]);
  expect(JSON.stringify(entries)).not.toMatch(/example\.test|Noor|06 1234/);
});

test("rejecting creates no membership", async () => {
  const applicant = await newApplicant();
  const id = await freshRequest(cast.workingGroup.workingGroupId, applicant);
  const res = await reject(cast.members.organizationAdmin, id);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ id, status: "rejected" });
  expect(await membershipsOf(applicant.id)).toEqual([]);
  expect(await auditOf(id)).toMatchObject([
    {
      action: "membership_request.rejected",
      actorUserId: cast.members.organizationAdmin.userId,
      organizationId: cast.organization.id,
    },
  ]);
});

test("the same decision again is 200 and writes nothing new", async () => {
  for (const decision of ["approve", "reject"] as const) {
    const applicant = await newApplicant();
    const id = await freshRequest(cast.workingGroup.workingGroupId, applicant);
    const first = await decide(cast.members.coordinator, id, decision);
    const again = await decide(cast.members.platformAdmin, id, decision);
    expect([first.statusCode, again.statusCode]).toEqual([200, 200]);
    expect(again.json()).toEqual(first.json());
    // The "unchanged" answer is about a decided request: no contact details either.
    expectNoContact(again, applicant);
    expect(await auditOf(id)).toHaveLength(1);
    expect(await membershipsOf(applicant.id)).toHaveLength(decision === "approve" ? 1 : 0);
    // The first decider stays on record.
    expect((await requestRow(id)).decidedByUserId).toBe(cast.members.coordinator.userId);
  }
});

test("the opposite decision is 409 already_decided", async () => {
  for (const [decision, opposite] of [
    ["approve", "reject"],
    ["reject", "approve"],
  ] as const) {
    const applicant = await newApplicant();
    const id = await freshRequest(cast.workingGroup.workingGroupId, applicant);
    expect((await decide(cast.members.coordinator, id, decision)).statusCode).toBe(200);
    const res = await decide(cast.members.coordinator, id, opposite);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "already_decided" });
    expect(await auditOf(id)).toHaveLength(1);
    expect(await membershipsOf(applicant.id)).toHaveLength(decision === "approve" ? 1 : 0);
  }
});

test("two reviewers deciding differently at the same moment: one 200, one 409, at most one membership", async () => {
  for (let i = 0; i < 3; i++) {
    const applicant = await newApplicant();
    const id = await freshRequest(cast.workingGroup.workingGroupId, applicant);
    const [a, b] = await Promise.all([
      approve(cast.members.coordinator, id),
      reject(cast.members.organizationAdmin, id),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const approved = a.statusCode === 200;
    expect((await requestRow(id)).status).toBe(approved ? "approved" : "rejected");
    expect(await membershipsOf(applicant.id)).toHaveLength(approved ? 1 : 0);
    expect(await auditOf(id)).toHaveLength(1);
  }
});

test("deciding a withdrawn request is 409 already_decided", async () => {
  const applicant = await newApplicant();
  const id = await freshRequest(cast.workingGroup.workingGroupId, applicant);
  await ctx.t.db
    .update(membershipRequests)
    .set({ status: "withdrawn", decidedAt: new Date() })
    .where(eq(membershipRequests.id, id));
  for (const decision of ["approve", "reject"] as const) {
    const res = await decide(cast.members.coordinator, id, decision);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "already_decided" });
  }
  expect(await membershipsOf(applicant.id)).toEqual([]);
  expect(await auditOf(id)).toEqual([]);
});

test("the applicant's stream gets access-changed, the coordinator's gets membership-requests-changed", async () => {
  const applicant = await loginAs(ctx, "aanvrager-stroom@example.test", { name: "Noor" });
  const id = await freshRequest(cast.workingGroup.workingGroupId, { id: applicant.userId });
  const before = hub!.listenerCount(liveEventsChannel);
  const applicantStream = await openEvents(baseUrl, applicant.headers);
  const coordinatorStream = await openEvents(baseUrl, cast.members.coordinator.headers);
  try {
    expect([applicantStream.status, coordinatorStream.status]).toEqual([200, 200]);
    await expect.poll(() => hub!.listenerCount(liveEventsChannel)).toBe(before + 2);
    expect((await approve(cast.members.coordinator, id)).statusCode).toBe(200);
    expect(await applicantStream.nextEvent()).toEqual({
      event: "access-changed",
      data: { type: "access-changed", userId: applicant.userId },
    });
    expect(await coordinatorStream.nextEvent()).toEqual({
      event: "membership-requests-changed",
      data: {
        type: "membership-requests-changed",
        workingGroupId: cast.workingGroup.workingGroupId,
        organizationId: cast.organization.id,
      },
    });
  } finally {
    applicantStream.close();
    coordinatorStream.close();
  }
});

test("an unknown request id is 404, the same as for an outsider", async () => {
  const unknown = uuidv7();
  for (const res of [
    await getOne(cast.members.platformAdmin, unknown),
    await approve(cast.members.platformAdmin, unknown),
    await reject(cast.members.coordinator, unknown),
  ]) {
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  }
  const outsider = await getOne(cast.members.coordinatorOtherOrganization, await freshRequest());
  expect(outsider.statusCode).toBe(404);
  expect(outsider.json()).toEqual(
    (await getOne(cast.members.coordinatorOtherOrganization, unknown)).json(),
  );
});

test("an unknown working group is 404", async () => {
  for (const who of [cast.members.platformAdmin, cast.members.coordinator]) {
    const res = await list(who, uuidv7());
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  }
});

test("ids that are not UUIDs are 400", async () => {
  for (const res of [
    await list(cast.members.platformAdmin, "noord"),
    await getOne(cast.members.platformAdmin, "1"),
    await approve(cast.members.platformAdmin, "not-a-uuid"),
    await reject(cast.members.platformAdmin, "not-a-uuid"),
  ]) {
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "invalid_request" });
  }
});

test("a decision from a foreign Origin is refused", async () => {
  const id = await freshRequest();
  const res = await approve(
    { headers: { ...cast.members.coordinator.headers, origin: "https://evil.example" } },
    id,
  );
  expect(res.statusCode).toBe(403);
  expect((await requestRow(id)).status).toBe("pending");
});
