import {
  auditLogEntries,
  createMembershipRequest,
  updateWorkingGroup,
  users,
  workingGroupMemberships,
} from "@padvinder/db";
import { and, count, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { testEnv } from "../test-env";
import { createCast, expectStatuses, type Cast } from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";

let ctx: TestApp;
let cast: Cast;

beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);
});
afterAll(async () => {
  await ctx?.close();
});

const groupId = () => cast.workingGroup.workingGroupId;
const post = (
  headers: Record<string, string>,
  emails: string[],
  workingGroupId: string = groupId(),
) =>
  ctx.app.inject({
    method: "POST",
    url: `/api/working-groups/${workingGroupId}/members`,
    headers,
    payload: { emails },
  });
const adder = () => cast.members.coordinator.headers;
const memberCount = async () => {
  const [row] = await ctx.t.db
    .select({ n: count() })
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, groupId()));
  return row!.n;
};
const jobKinds = () => ctx.mailQueue.jobs.map((job) => job.kind);
const approvalMails = () => ctx.mailer.sent.filter((mail) => mail.subject.includes("toegelaten"));

let n = 0;
const fresh = () => `nieuw-${n++}@example.test`;

/** A coordinator of the group with no additions yet, for the tests of the limits. */
async function freshCoordinator() {
  const session = await loginAs(ctx, `adder-${n++}@example.test`, { name: "Adder" });
  await ctx.t.db
    .insert(workingGroupMemberships)
    .values({ userId: session.userId, workingGroupId: groupId(), isCoordinator: true });
  return session;
}

async function insertAdditions(userId: string, howMany: number) {
  await ctx.t.db.insert(auditLogEntries).values(
    Array.from({ length: howMany }, () => ({
      actorKind: "user" as const,
      actorUserId: userId,
      organizationId: cast.organization.id,
      action: "membership.added",
      subjectType: "user",
      subjectId: uuidv7(),
      details: { workingGroupId: groupId() },
    })),
  );
}

test("coordinators and admins of the group add people, nobody else", async () => {
  await expectStatuses(
    cast,
    {
      platformAdmin: 200,
      organizationAdmin: 200,
      coordinator: 200,
      volunteer: 403,
      volunteerOtherGroup: 404,
      coordinatorOtherOrganization: 404,
      organizationAdminOtherOrganization: 404,
      applicant: 404,
      anonymous: 401,
    },
    (headers) => post(headers, [fresh()]),
  );
});

test("a list with every kind of address gives one outcome each, in order", async () => {
  await loginAs(ctx, "profiel-1@example.test", {
    name: "Geheime Naam",
    phone: "06 99999999",
  });
  const applicant = await loginAs(ctx, "aanmelder-1@example.test", { name: "Noor Aanmelder" });
  const requested = await createMembershipRequest(ctx.t.db, {
    id: uuidv7(),
    userId: applicant.userId,
    workingGroupId: groupId(),
    requestedAt: new Date(),
    now: new Date(),
  });
  expect(requested.outcome).toBe("created");
  const newAddress = fresh();
  const never = fresh();
  await ctx.t.db.insert(users).values({ email: never, name: "" });

  const before = await memberCount();
  const jobsBefore = ctx.mailQueue.jobs.length;
  const mailsBefore = approvalMails().length;
  const res = await post(adder(), [
    newAddress,
    never,
    "profiel-1@example.test",
    "aanmelder-1@example.test",
    cast.members.volunteer.email,
    newAddress.toUpperCase(),
    "jan@",
  ]);
  expect(res.statusCode).toBe(200);
  expect(res.json().results).toEqual([
    { email: newAddress, outcome: "added" },
    { email: never, outcome: "added" },
    { email: "profiel-1@example.test", outcome: "invited" },
    { email: "aanmelder-1@example.test", outcome: "approved" },
    { email: cast.members.volunteer.email, outcome: "already_member" },
    { email: "jan@", outcome: "invalid" },
  ]);
  // The two added and the approved one.
  expect(await memberCount()).toBe(before + 3);
  expect(jobKinds().slice(jobsBefore).sort()).toEqual([
    "added-to-working-group",
    "added-to-working-group",
    "invited-to-working-group",
  ]);
  await vi.waitFor(() => expect(approvalMails().length).toBe(mailsBefore + 1), { timeout: 2000 });
});

test("the raw answer holds no name and no phone number of the person with a profile", async () => {
  await loginAs(ctx, "profiel-2@example.test", { name: "Geheime Naam", phone: "06 99999999" });
  const applicant = await loginAs(ctx, "aanmelder-2@example.test", { name: "Aanmelder Geheim" });
  await createMembershipRequest(ctx.t.db, {
    id: uuidv7(),
    userId: applicant.userId,
    workingGroupId: groupId(),
    requestedAt: new Date(),
    now: new Date(),
  });
  const res = await post(adder(), ["profiel-2@example.test", "aanmelder-2@example.test"]);
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({
    results: [
      { email: "profiel-2@example.test", outcome: "invited" },
      { email: "aanmelder-2@example.test", outcome: "approved" },
    ],
  });
  for (const text of ["Geheime", "99999999", "Aanmelder", "approvedRequest", "phone"]) {
    expect(res.body).not.toContain(text);
  }
});

test("the same list again changes nothing and queues nothing", async () => {
  await loginAs(ctx, "profiel-3@example.test", { name: "Profiel Drie" });
  const list = [fresh(), "profiel-3@example.test"];
  const first = await post(adder(), list);
  expect(first.json().results.map((r: { outcome: string }) => r.outcome)).toEqual([
    "added",
    "invited",
  ]);
  const before = await memberCount();
  const jobs = ctx.mailQueue.jobs.length;
  const second = await post(adder(), list);
  expect(second.statusCode).toBe(200);
  expect(second.json().results.map((r: { outcome: string }) => r.outcome)).toEqual([
    "already_member",
    "invited",
  ]);
  expect(await memberCount()).toBe(before);
  expect(ctx.mailQueue.jobs.length).toBe(jobs);
});

test("201 addresses are 429 too_many_addresses and nobody is added", async () => {
  const before = await memberCount();
  const jobs = ctx.mailQueue.jobs.length;
  const res = await post(
    adder(),
    Array.from({ length: 201 }, (_, i) => `veel-${i}@example.test`),
  );
  expect(res.statusCode).toBe(429);
  expect(res.json()).toMatchObject({ code: "too_many_addresses" });
  expect(await memberCount()).toBe(before);
  expect(ctx.mailQueue.jobs.length).toBe(jobs);
  const [account] = await ctx.t.db
    .select({ n: count() })
    .from(users)
    .where(eq(users.email, "veel-0@example.test"));
  expect(account!.n).toBe(0);
});

test("200 addresses that are all one address count as one", async () => {
  const address = fresh();
  const res = await post(
    adder(),
    Array.from({ length: 200 }, (_, i) => (i % 2 ? address.toUpperCase() : ` ${address} `)),
  );
  expect(res.statusCode).toBe(200);
  expect(res.json().results).toEqual([{ email: address, outcome: "added" }]);
});

test("the 501st person of the day is 429 too_many_additions", async () => {
  const session = await freshCoordinator();
  await insertAdditions(session.userId, 400);
  const over = await post(
    session.headers,
    Array.from({ length: 101 }, () => fresh()),
  );
  expect(over.statusCode).toBe(429);
  expect(over.json()).toMatchObject({ code: "too_many_additions" });
  const [added] = await ctx.t.db
    .select({ n: count() })
    .from(auditLogEntries)
    .where(
      and(
        eq(auditLogEntries.actorUserId, session.userId),
        eq(auditLogEntries.action, "membership.added"),
      ),
    );
  expect(added!.n).toBe(400);
  const ok = await post(
    session.headers,
    Array.from({ length: 100 }, () => fresh()),
  );
  expect(ok.statusCode).toBe(200);
  expect(ok.json().results).toHaveLength(100);
});

test("an empty list, a body without emails and an unknown key are 400", async () => {
  const url = `/api/working-groups/${groupId()}/members`;
  for (const payload of [{ emails: [] }, {}, { emails: ["a@example.test"], extra: 1 }]) {
    const res = await ctx.app.inject({ method: "POST", url, headers: adder(), payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "invalid_request" });
  }
});

test("a list of only empty lines adds nobody and answers an empty list", async () => {
  const res = await post(adder(), ["", "  "]);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ results: [] });
});

test("an unknown working group is 404", async () => {
  const res = await post(adder(), [fresh()], uuidv7());
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ code: "not_found" });
});

test("the audit entries name the adder and hold no address", async () => {
  const address = fresh();
  const res = await post(adder(), [address]);
  expect(res.statusCode).toBe(200);
  const [account] = await ctx.t.db.select().from(users).where(eq(users.email, address));
  const entries = await ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(eq(auditLogEntries.subjectId, account!.id));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    action: "membership.added",
    actorUserId: cast.members.coordinator.userId,
    organizationId: cast.organization.id,
    details: { workingGroupId: groupId() },
  });
  expect(JSON.stringify(entries[0])).not.toContain("@");
});

test("an admin adds people to a switched-off group", async () => {
  await updateWorkingGroup(
    ctx.t.db,
    { workingGroupId: cast.otherGroup.workingGroupId, patch: { active: false } },
    { kind: "system" },
  );
  try {
    const res = await post(
      cast.members.organizationAdmin.headers,
      [fresh()],
      cast.otherGroup.workingGroupId,
    );
    expect(res.statusCode).toBe(200);
  } finally {
    await updateWorkingGroup(
      ctx.t.db,
      { workingGroupId: cast.otherGroup.workingGroupId, patch: { active: true } },
      { kind: "system" },
    );
  }
});

test("a POST from a foreign Origin is refused", async () => {
  const address = fresh();
  const res = await post({ ...adder(), origin: "https://evil.example" }, [address]);
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ code: "origin_not_allowed" });
  const own = await post({ ...adder(), origin: testEnv.PUBLIC_ORIGIN }, [address]);
  expect(own.statusCode).toBe(200);
});
