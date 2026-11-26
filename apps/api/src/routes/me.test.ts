import { afterAll, beforeAll, expect, test } from "vitest";
import {
  grantCoordinator,
  grantPlatformAdmin,
  membershipRequests,
  passkeys,
  users,
  workingGroupMemberships,
} from "@padvinder/db";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { createCast, type Cast } from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";
import { stampSession } from "../testing/passkeys";

let ctx: TestApp;
let cast: Cast;
beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);
});
afterAll(() => ctx.close());

const patch = (headers: Record<string, string>, payload: unknown) =>
  ctx.app.inject({ method: "PATCH", url: "/api/me", headers, payload: payload as object });

test("401 without a login", async () => {
  const res = await ctx.app.inject("/api/me");
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ statusCode: 401, code: "not_logged_in" });
});

test("PATCH without a login is 401", async () => {
  const res = await patch({}, { name: "X" });
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ code: "not_logged_in" });
});

test("returns the logged-in user", async () => {
  const noor = await loginAs(ctx, "noor@example.test", { name: "Noor de Vries" });
  const res = await ctx.app.inject({ url: "/api/me", headers: noor.headers });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    user: {
      id: noor.userId,
      name: "Noor de Vries",
      email: "noor@example.test",
      phone: null,
      isPlatformAdmin: false,
      hasPasskey: false,
    },
    memberships: [],
    organizationAdminOf: [],
    membershipRequest: null,
    adminConfirmedUntil: null,
  });
});

test("GET shows a change made by PATCH right away, phone included", async () => {
  const user = await loginAs(ctx, "fresh@example.test", { name: "Fem" });
  await patch(user.headers, { name: "Femke", phone: "06 3" });
  const res = await ctx.app.inject({ url: "/api/me", headers: user.headers });
  expect(res.json().user).toMatchObject({ name: "Femke", phone: "06 3" });
});

test("a session whose user is gone is 401", async () => {
  const user = await loginAs(ctx, "gone@example.test");
  await ctx.t.db.delete(users).where(eq(users.id, user.userId));
  const res = await ctx.app.inject({ url: "/api/me", headers: user.headers });
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ code: "not_logged_in" });
});

test("PATCH changes only what is sent", async () => {
  const user = await loginAs(ctx, "patch@example.test", { name: "Piet" });
  const first = await patch(user.headers, { phone: "06 1" });
  expect(first.statusCode).toBe(200);
  expect(first.json().user).toMatchObject({ name: "Piet", phone: "06 1" });
  const second = await patch(user.headers, { name: " Pieter " });
  expect(second.json().user).toMatchObject({ name: "Pieter", phone: "06 1" });
  const cleared = await patch(user.headers, { phone: null });
  expect(cleared.json().user).toMatchObject({ name: "Pieter", phone: null });
  const blank = await patch(user.headers, { phone: "06 2" });
  expect(blank.json().user.phone).toBe("06 2");
  expect((await patch(user.headers, { phone: "  " })).json().user.phone).toBeNull();
});

test("PATCH rejects an unknown key and an empty body with 400", async () => {
  const user = await loginAs(ctx, "strict@example.test", { name: "Strict" });
  for (const body of [{ nam: "x" }, {}, { name: "" }, { name: null }, { name: "a", extra: 1 }]) {
    const res = await patch(user.headers, body);
    expect(res.statusCode, JSON.stringify(body)).toBe(400);
    expect(res.json()).toMatchObject({ code: "invalid_request" });
  }
  const me = await ctx.app.inject({ url: "/api/me", headers: user.headers });
  expect(me.json().user.name).toBe("Strict");
});

test("PATCH with the same body twice gives the same result", async () => {
  const user = await loginAs(ctx, "twice@example.test", { name: "Twice" });
  const one = await patch(user.headers, { name: "Dubbel", phone: "06 3" });
  const two = await patch(user.headers, { name: "Dubbel", phone: "06 3" });
  expect(two.statusCode).toBe(200);
  expect(two.json()).toEqual(one.json());
});

test("PATCH never changes another user", async () => {
  const a = await loginAs(ctx, "a@example.test", { name: "A" });
  const b = await loginAs(ctx, "b@example.test", { name: "B", phone: "06 9" });
  await patch(a.headers, { name: "A2", phone: "06 1" });
  const res = await ctx.app.inject({ url: "/api/me", headers: b.headers });
  expect(res.json().user).toMatchObject({ id: b.userId, name: "B", phone: "06 9" });
});

test("PATCH from a foreign Origin is refused", async () => {
  const user = await loginAs(ctx, "origin@example.test", { name: "Origin" });
  const res = await patch({ ...user.headers, origin: "https://evil.example" }, { name: "Hacked" });
  expect(res.statusCode).toBe(403);
  const me = await ctx.app.inject({ url: "/api/me", headers: user.headers });
  expect(me.json().user.name).toBe("Origin");
});

test("a session does not set a cookie on GET", async () => {
  const user = await loginAs(ctx, "cookie@example.test");
  const res = await ctx.app.inject({ url: "/api/me", headers: user.headers });
  expect(res.headers["set-cookie"]).toBeUndefined();
});

/** Moves the user's session into Better Auth's renewal window (older than `updateAge`). */
async function ageSession(userId: string) {
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(old.getTime() + 180 * 24 * 60 * 60 * 1000);
  await ctx.t.pool.query(
    "update sessions set updated_at = $1, expires_at = $2 where user_id = $3",
    [old, expiresAt, userId],
  );
  return expiresAt;
}

test("an old session is renewed and GET /api/me sets a fresh cookie", async () => {
  const user = await loginAs(ctx, "renew@example.test");
  const oldExpiry = await ageSession(user.userId);
  const res = await ctx.app.inject({ url: "/api/me", headers: user.headers });
  expect(res.statusCode).toBe(200);
  expect(String(res.headers["set-cookie"])).toContain("padvinder.session_token=");
  const { rows } = await ctx.t.pool.query("select expires_at from sessions where user_id = $1", [
    user.userId,
  ]);
  expect(rows[0].expires_at.getTime()).toBeGreaterThan(oldExpiry.getTime());
});

const getMe = async (headers: Record<string, string>) =>
  (await ctx.app.inject({ url: "/api/me", headers })).json();

test("a volunteer sees their one membership", async () => {
  expect(await getMe(cast.members.volunteer.headers)).toMatchObject({
    user: { isPlatformAdmin: false },
    memberships: [
      {
        isCoordinator: false,
        workingGroup: {
          id: cast.workingGroup.workingGroupId,
          organization: { id: cast.organization.id, name: "Cast Organisatie" },
        },
      },
    ],
    organizationAdminOf: [],
  });
});

test("someone in two organizations sees both memberships", async () => {
  const user = await loginAs(ctx, "two-orgs@example.test", { name: "Twee" });
  await grantCoordinator(
    ctx.t.db,
    { email: "two-orgs@example.test", workingGroupId: cast.foreignGroup.workingGroupId },
    { kind: "system" },
  );
  await grantCoordinator(
    ctx.t.db,
    { email: "two-orgs@example.test", workingGroupId: cast.workingGroup.workingGroupId },
    { kind: "system" },
  );
  const me = await getMe(user.headers);
  expect(me.memberships).toHaveLength(2);
  expect(
    me.memberships
      .map(
        (m: { workingGroup: { organization: { id: string } } }) => m.workingGroup.organization.id,
      )
      .sort(),
  ).toEqual([cast.organization.id, cast.otherOrganization.id].sort());
  expect(me.memberships.every((m: { isCoordinator: boolean }) => m.isCoordinator)).toBe(true);
});

test("a coordinator has the coordinator flag", async () => {
  const me = await getMe(cast.members.coordinator.headers);
  expect(me.memberships).toMatchObject([{ isCoordinator: true }]);
});

test("an organization admin sees the organization", async () => {
  expect(await getMe(cast.members.organizationAdmin.headers)).toMatchObject({
    memberships: [],
    organizationAdminOf: [{ id: cast.organization.id, name: "Cast Organisatie" }],
  });
});

test("a platform admin has the flag", async () => {
  expect(await getMe(cast.members.platformAdmin.headers)).toMatchObject({
    user: { isPlatformAdmin: true },
  });
});

test("an applicant has empty lists", async () => {
  expect(await getMe(cast.members.applicant.headers)).toMatchObject({
    memberships: [],
    organizationAdminOf: [],
  });
});

test("PATCH still returns the full shape", async () => {
  const res = await patch(cast.members.volunteer.headers, { phone: "06 5" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({
    user: { phone: "06 5", isPlatformAdmin: false },
    memberships: [{ isCoordinator: false }],
    organizationAdminOf: [],
  });
});

const askToJoin = (headers: Record<string, string>, workingGroupId: string) => {
  const payload = { id: uuidv7(), workingGroupId, requestedAt: "2027-01-10T19:00:00+01:00" };
  return ctx.app
    .inject({ method: "POST", url: "/api/membership-requests", headers, payload })
    .then((res) => ({ id: payload.id, res }));
};

test("me shows the pending request, then the rejected one, then null after a new membership", async () => {
  const user = await loginAs(ctx, "waiting@example.test", { name: "Wachtend" });
  const { id, res } = await askToJoin(user.headers, cast.workingGroup.workingGroupId);
  expect(res.statusCode).toBe(201);
  const pending = await getMe(user.headers);
  expect(pending.membershipRequest).toEqual(res.json());
  expect(pending.membershipRequest).toMatchObject({
    id,
    status: "pending",
    decidedAt: null,
    workingGroup: { id: cast.workingGroup.workingGroupId, name: "Cast Werkgroep" },
  });

  const decidedAt = new Date("2027-01-11T09:00:00Z");
  await ctx.t.db
    .update(membershipRequests)
    .set({ status: "rejected", decidedAt })
    .where(eq(membershipRequests.id, id));
  expect((await getMe(user.headers)).membershipRequest).toMatchObject({
    id,
    status: "rejected",
    decidedAt: "2027-01-11T09:00:00.000Z",
  });

  // A new request for another group, approved: the newest request is no longer open.
  const second = await askToJoin(user.headers, cast.otherGroup.workingGroupId);
  expect(second.res.statusCode).toBe(201);
  await ctx.t.db.transaction(async (tx) => {
    await tx
      .update(membershipRequests)
      .set({ status: "approved", decidedAt })
      .where(eq(membershipRequests.id, second.id));
    await tx.insert(workingGroupMemberships).values({
      userId: user.userId,
      workingGroupId: cast.otherGroup.workingGroupId,
    });
  });
  const member = await getMe(user.headers);
  expect(member.membershipRequest).toBeNull();
  expect(member.memberships).toMatchObject([
    { workingGroup: { id: cast.otherGroup.workingGroupId } },
  ]);
});

test("me shows null after a withdrawal", async () => {
  const user = await loginAs(ctx, "withdrawing@example.test", { name: "Terugtrekker" });
  const { id } = await askToJoin(user.headers, cast.workingGroup.workingGroupId);
  expect((await getMe(user.headers)).membershipRequest).toMatchObject({ id, status: "pending" });
  const res = await ctx.app.inject({
    method: "POST",
    url: `/api/membership-requests/${id}/withdraw`,
    headers: user.headers,
  });
  expect(res.statusCode).toBe(200);
  expect((await getMe(user.headers)).membershipRequest).toBeNull();
});

test("a member without requests has membershipRequest null", async () => {
  expect((await getMe(cast.members.volunteer.headers)).membershipRequest).toBeNull();
});

test("me shows an older pending request over a newer withdrawn or rejected one", async () => {
  for (const status of ["withdrawn", "rejected"] as const) {
    const user = await loginAs(ctx, `older-pending-${status}@example.test`, { name: "Ouder" });
    const older = await askToJoin(user.headers, cast.workingGroup.workingGroupId);
    const newer = await askToJoin(user.headers, cast.otherGroup.workingGroupId);
    expect([older.res.statusCode, newer.res.statusCode]).toEqual([201, 201]);
    await ctx.t.db
      .update(membershipRequests)
      .set({ status, decidedAt: new Date() })
      .where(eq(membershipRequests.id, newer.id));
    expect((await getMe(user.headers)).membershipRequest, status).toEqual(older.res.json());
  }
});

const meOf = async (who: { headers: Record<string, string> }) =>
  (await ctx.app.inject({ method: "GET", url: "/api/me", headers: who.headers })).json();

test("me says hasPasskey, and adminConfirmedUntil for a confirmed admin only", async () => {
  const confirmed = await loginAs(ctx, `confirmed-${uuidv7().slice(-8)}@example.test`);
  const unconfirmed = await loginAs(ctx, `unconfirmed-${uuidv7().slice(-8)}@example.test`);
  const volunteer = await loginAs(ctx, `plain-${uuidv7().slice(-8)}@example.test`);
  for (const who of [confirmed, unconfirmed]) {
    const [row] = await ctx.t.db.select().from(users).where(eq(users.id, who.userId));
    await grantPlatformAdmin(ctx.t.db, { email: row!.email }, { kind: "system" });
  }
  await ctx.t.db.insert(passkeys).values({
    userId: confirmed.userId,
    publicKey: "pk",
    credentialID: `cred-${uuidv7()}`,
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
  });
  await stampSession(ctx, confirmed.headers.cookie, new Date());

  const a = await meOf(confirmed);
  expect(a.user.hasPasskey).toBe(true);
  expect(typeof a.adminConfirmedUntil).toBe("string");
  const b = await meOf(unconfirmed);
  expect(b.user.hasPasskey).toBe(false);
  expect(b.adminConfirmedUntil).toBeNull();
  const c = await meOf(volunteer);
  expect(c.user.hasPasskey).toBe(false);
  expect(c.adminConfirmedUntil).toBeNull();
  // A volunteer's stamp does not make them confirmed.
  await stampSession(ctx, volunteer.headers.cookie, new Date());
  expect((await meOf(volunteer)).adminConfirmedUntil).toBeNull();
});

test("adminConfirmedUntil is the passkey moment plus 24 hours, with an offset", async () => {
  const admin = await loginAs(ctx, `until-${uuidv7().slice(-8)}@example.test`);
  const [row] = await ctx.t.db.select().from(users).where(eq(users.id, admin.userId));
  await grantPlatformAdmin(ctx.t.db, { email: row!.email }, { kind: "system" });
  const at = new Date(Date.now() - 3 * 3_600_000);
  await stampSession(ctx, admin.headers.cookie, at);
  const until = (await meOf(admin)).adminConfirmedUntil as string;
  expect(until).toMatch(/(Z|[+-]\d\d:\d\d)$/);
  expect(new Date(until).getTime()).toBe(at.getTime() + 24 * 3_600_000);
});
