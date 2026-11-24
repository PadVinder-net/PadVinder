import { createWorkingGroup, membershipRequests, workingGroups } from "@padvinder/db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4, v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createCast, expectStatuses, type Cast } from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";

let ctx: TestApp;
let cast: Cast;
beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);
});
afterAll(() => ctx.close());

type Headers = { headers: Record<string, string> };

const body = (workingGroupId = cast.workingGroup.workingGroupId) => ({
  id: uuidv7(),
  workingGroupId,
  requestedAt: "2027-01-10T19:00:00+01:00",
});

const post = (who: Headers, payload: object) =>
  ctx.app.inject({
    method: "POST",
    url: "/api/membership-requests",
    headers: who.headers,
    payload,
  });

const withdraw = (who: Headers, id: string) =>
  ctx.app.inject({
    method: "POST",
    url: `/api/membership-requests/${id}/withdraw`,
    headers: who.headers,
  });

let applicants = 0;
/** A fresh logged-in user without memberships, so tests do not share requests or limits. */
const newApplicant = () =>
  loginAs(ctx, `aanvrager-${applicants++}@example.test`, { name: "Aanvrager" });

const rowsOf = (userId: string) =>
  ctx.t.db.select().from(membershipRequests).where(eq(membershipRequests.userId, userId));

async function newGroup(name: string) {
  const group = await createWorkingGroup(
    ctx.t.db,
    { organizationId: cast.organization.id, name, city: "Enschede" },
    { kind: "system" },
  );
  return group.id;
}

test("everyone logged in may ask, except for a group they belong to", async () => {
  // The cast's coordinator and volunteer belong to cast.workingGroup; admin rights do not count
  // as a membership.
  try {
    await expectStatuses(
      cast,
      {
        platformAdmin: 201,
        organizationAdmin: 201,
        coordinator: 409,
        volunteer: 409,
        volunteerOtherGroup: 201,
        coordinatorOtherOrganization: 201,
        applicant: 201,
        anonymous: 401,
      },
      (headers) => post({ headers }, body()),
    );
  } finally {
    // Clean up, so the other tests start from a cast without requests, also after a failure.
    await ctx.t.db.delete(membershipRequests);
  }
});

test("an applicant asks to join: 201 and a pending request", async () => {
  const applicant = await newApplicant();
  const b = body();
  const res = await post(applicant, b);
  expect(res.statusCode).toBe(201);
  expect(res.json()).toEqual({
    id: b.id,
    status: "pending",
    requestedAt: "2027-01-10T18:00:00.000Z",
    decidedAt: null,
    workingGroup: {
      id: cast.workingGroup.workingGroupId,
      name: "Cast Werkgroep",
      city: "Enschede",
      organization: { id: cast.organization.id, name: "Cast Organisatie" },
    },
  });
  // Nothing of the server's bookkeeping or of the user leaks into the answer.
  expect(Object.keys(res.json()).sort()).toEqual([
    "decidedAt",
    "id",
    "requestedAt",
    "status",
    "workingGroup",
  ]);
});

test("the same id twice gives one row; the second answer is 200 with the same record", async () => {
  const applicant = await newApplicant();
  const b = body();
  const first = await post(applicant, b);
  const second = await post(applicant, b);
  expect([first.statusCode, second.statusCode]).toEqual([201, 200]);
  expect(second.json()).toEqual(first.json());
  expect(await rowsOf(applicant.userId)).toHaveLength(1);
});

test("the same id sent twice at the same moment gives one row", async () => {
  const applicant = await newApplicant();
  const b = body();
  const answers = await Promise.all([post(applicant, b), post(applicant, b)]);
  expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 201]);
  expect(answers[0]!.json()).toEqual(answers[1]!.json());
  expect(await rowsOf(applicant.userId)).toHaveLength(1);
});

test("two new ids for the same group at the same moment give one row and one 409", async () => {
  const applicant = await newApplicant();
  const answers = await Promise.all([post(applicant, body()), post(applicant, body())]);
  expect(answers.map((a) => a.statusCode).sort()).toEqual([201, 409]);
  expect(answers.find((a) => a.statusCode === 409)!.json()).toMatchObject({
    code: "already_requested",
  });
  expect(await rowsOf(applicant.userId)).toHaveLength(1);
});

test("an id that belongs to someone else is 409 id_in_use and shows nothing of it", async () => {
  const owner = await newApplicant();
  const other = await newApplicant();
  const b = body();
  await post(owner, b);
  const res = await post(other, { ...b, workingGroupId: cast.otherGroup.workingGroupId });
  expect(res.statusCode).toBe(409);
  expect(res.json()).toEqual({
    statusCode: 409,
    error: "Conflict",
    message: expect.any(String),
    code: "id_in_use",
  });
  expect(res.body).not.toContain(cast.workingGroup.workingGroupId);
  expect(res.body).not.toContain(owner.userId);
  expect(await rowsOf(other.userId)).toHaveLength(0);
});

test("a second request for the same group with a new id is 409 already_requested", async () => {
  const applicant = await newApplicant();
  await post(applicant, body());
  const res = await post(applicant, body());
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ code: "already_requested" });
  expect(await rowsOf(applicant.userId)).toHaveLength(1);
});

test("a member asking for their own group is 409 already_member", async () => {
  for (const member of [cast.members.volunteer, cast.members.coordinator]) {
    const res = await post(member, body());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "already_member" });
  }
});

test("a request for another group is allowed while one is pending", async () => {
  const applicant = await newApplicant();
  expect((await post(applicant, body())).statusCode).toBe(201);
  expect((await post(applicant, body(cast.otherGroup.workingGroupId))).statusCode).toBe(201);
  expect(await rowsOf(applicant.userId)).toHaveLength(2);
});

test("an inactive or unknown working group is 404", async () => {
  const applicant = await newApplicant();
  const inactive = await newGroup("Opgeheven");
  await ctx.t.db.update(workingGroups).set({ active: false }).where(eq(workingGroups.id, inactive));
  for (const workingGroupId of [inactive, uuidv7()]) {
    const res = await post(applicant, body(workingGroupId));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  }
  expect(await rowsOf(applicant.userId)).toHaveLength(0);
});

test("the sixth request within 24 hours is 429; resending a stored id is not counted", async () => {
  const applicant = await newApplicant();
  const groups = [cast.workingGroup.workingGroupId, cast.otherGroup.workingGroupId];
  for (let i = groups.length; i < 6; i++) groups.push(await newGroup(`Limiet ${i}`));
  const sent: ReturnType<typeof body>[] = [];
  for (let i = 0; i < 5; i++) {
    const b = body(groups[i]);
    sent.push(b);
    expect((await post(applicant, b)).statusCode).toBe(201);
    // Resending a stored id answers the stored record and does not count.
    expect((await post(applicant, b)).statusCode).toBe(200);
  }
  const res = await post(applicant, body(groups[5]));
  expect(res.statusCode).toBe(429);
  expect(res.json()).toMatchObject({ code: "too_many_requests" });
  // Withdrawing does not give the request back.
  expect((await withdraw(applicant, sent[0]!.id)).statusCode).toBe(200);
  expect((await post(applicant, body(groups[5]))).statusCode).toBe(429);
  // Over the limit, a resend is still answered with the stored record.
  expect((await post(applicant, sent[1]!)).statusCode).toBe(200);
  expect(await rowsOf(applicant.userId)).toHaveLength(5);
});

test("requestedAt is the app's time and receivedAt the server's", async () => {
  const applicant = await newApplicant();
  const b = { ...body(), requestedAt: "2027-01-10T19:00:00+01:00" };
  const before = Date.now();
  await post(applicant, b);
  const [row] = await rowsOf(applicant.userId);
  expect(row!.requestedAt.toISOString()).toBe("2027-01-10T18:00:00.000Z");
  expect(row!.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  expect(row!.receivedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
});

test("a body without a UUIDv7 id is 400", async () => {
  const applicant = await newApplicant();
  for (const payload of [
    { ...body(), id: uuidv4() },
    { ...body(), id: "1" },
    { workingGroupId: cast.workingGroup.workingGroupId, requestedAt: "2027-01-10T19:00:00+01:00" },
    { ...body(), workingGroupId: "noord" },
    { ...body(), requestedAt: "2027-01-10T19:00:00" },
  ]) {
    const res = await post(applicant, payload);
    expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    expect(res.json()).toMatchObject({ code: "invalid_request" });
  }
  expect(await rowsOf(applicant.userId)).toHaveLength(0);
});

test("401 without a login", async () => {
  const res = await post({ headers: {} }, body());
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ code: "not_logged_in" });
  const withdrawn = await withdraw({ headers: {} }, uuidv7());
  expect(withdrawn.statusCode).toBe(401);
});

test("a foreign Origin is refused", async () => {
  const applicant = await newApplicant();
  const res = await post(
    { headers: { ...applicant.headers, origin: "https://evil.example" } },
    body(),
  );
  expect(res.statusCode).toBe(403);
  expect(await rowsOf(applicant.userId)).toHaveLength(0);
});

test("withdrawing sets withdrawn; again is 200 unchanged; someone else's is 404", async () => {
  const applicant = await newApplicant();
  const other = await newApplicant();
  const b = body();
  const created = (await post(applicant, b)).json();

  const foreign = await withdraw(other, b.id);
  expect(foreign.statusCode).toBe(404);
  expect(foreign.json()).toMatchObject({ code: "not_found" });
  expect(foreign.body).not.toContain(cast.workingGroup.workingGroupId);

  const res = await withdraw(applicant, b.id);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ...created, status: "withdrawn", decidedAt: expect.any(String) });
  const again = await withdraw(applicant, b.id);
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual(res.json());
  expect((await rowsOf(applicant.userId))[0]!.status).toBe("withdrawn");

  expect((await withdraw(applicant, uuidv7())).statusCode).toBe(404);
});

test("withdrawing with an id that is not a UUID is 400", async () => {
  const applicant = await newApplicant();
  const res = await withdraw(applicant, "not-a-uuid");
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ code: "invalid_request" });
});

test("withdrawing a decided request is 409 already_decided", async () => {
  const applicant = await newApplicant();
  for (const status of ["approved", "rejected"] as const) {
    const b = body(await newGroup(`Besloten ${status}`));
    await post(applicant, b);
    await ctx.t.db
      .update(membershipRequests)
      .set({ status, decidedAt: new Date() })
      .where(eq(membershipRequests.id, b.id));
    const res = await withdraw(applicant, b.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "already_decided" });
  }
});

test("after a rejection the applicant may ask again, also for the same group", async () => {
  const applicant = await newApplicant();
  const first = body();
  await post(applicant, first);
  await ctx.t.db
    .update(membershipRequests)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(eq(membershipRequests.id, first.id));
  expect((await post(applicant, body())).statusCode).toBe(201);
  expect(await rowsOf(applicant.userId)).toHaveLength(2);
});

test("only the applicant may withdraw their request; for everyone else it does not exist", async () => {
  const b = body(cast.otherGroup.workingGroupId);
  expect((await post(cast.members.applicant, b)).statusCode).toBe(201);
  await expectStatuses(
    cast,
    {
      platformAdmin: 404,
      organizationAdmin: 404,
      coordinator: 404,
      volunteer: 404,
      volunteerOtherGroup: 404,
      coordinatorOtherOrganization: 404,
      applicant: 200,
      anonymous: 401,
    },
    (headers) => withdraw({ headers }, b.id),
  );
});
