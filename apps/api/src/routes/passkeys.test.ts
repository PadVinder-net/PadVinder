import {
  auditLogEntries,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  passkeys,
  sessions,
} from "@padvinder/db";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createCast, expectStatuses, type Cast, type CastLogin } from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";
import { stampSession } from "../testing/passkeys";

let ctx: TestApp;
let cast: Cast;
beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);
});
afterAll(() => ctx.close());

const system = { kind: "system" } as const;
let n = 0;
const address = (label: string) => `${label}-${++n}-${uuidv7().slice(-8)}@example.test`;

type Headers = Record<string, string>;
type Who = { headers: Headers };
const send = (who: Who, method: "GET" | "DELETE", url: string) =>
  ctx.app.inject({ method, url, headers: who.headers });
const list = (who: Who) => send(who, "GET", "/api/passkeys");
const removeOwn = (who: Who, id: string) => send(who, "DELETE", `/api/passkeys/${id}`);
const resetOrganizationAdmin = (who: Who, organizationId: string, userId: string) =>
  send(who, "DELETE", `/api/organizations/${organizationId}/admins/${userId}/passkeys`);
const resetPlatformAdmin = (who: Who, userId: string) =>
  send(who, "DELETE", `/api/platform-admins/${userId}/passkeys`);

/** A passkey row for the user, made without the browser ceremony. */
async function insertPasskey(userId: string): Promise<string> {
  const [row] = await ctx.t.db
    .insert(passkeys)
    .values({
      userId,
      publicKey: `public-key-${++n}`,
      credentialID: `credential-id-${n}-${uuidv7()}`,
      counter: 7,
      deviceType: "multiDevice",
      backedUp: true,
      aaguid: "aaguid-secret",
    })
    .returning({ id: passkeys.id });
  return row!.id;
}
const passkeysOf = async (userId: string) =>
  ctx.t.db.select().from(passkeys).where(eq(passkeys.userId, userId));

/** A logged-in admin of the cast's organization with a passkey, confirmed just now. */
async function newOrganizationAdmin() {
  const email = address("admin");
  const login = await loginAs(ctx, email);
  await grantOrganizationAdmin(ctx.t.db, { email, organizationId: cast.organization.id }, system);
  await stampSession(ctx, login.headers.cookie, new Date());
  const passkeyId = await insertPasskey(login.userId);
  return { ...login, email, passkeyId };
}

async function newPlatformAdmin() {
  const email = address("platform");
  const login = await loginAs(ctx, email);
  await grantPlatformAdmin(ctx.t.db, { email }, system);
  await stampSession(ctx, login.headers.cookie, new Date());
  const passkeyId = await insertPasskey(login.userId);
  return { ...login, email, passkeyId };
}

const adminsOnly = (ok: number) => ({
  platformAdmin: ok,
  organizationAdmin: ok,
  coordinator: 403,
  volunteer: 403,
  volunteerOtherGroup: 403,
  coordinatorOtherOrganization: 403,
  organizationAdminOtherOrganization: ok,
  applicant: 403,
  anonymous: 401,
});

const memberOf = (headers: Headers): CastLogin | undefined =>
  Object.values(cast.members).find((member) => member.headers.cookie === headers.cookie);

test("only admins list their own passkeys", async () => {
  await expectStatuses(cast, adminsOnly(200), (headers) => list({ headers }));
});

test("only admins remove one of their own", async () => {
  await expectStatuses(cast, adminsOnly(204), async (headers) => {
    const member = memberOf(headers);
    const id = member ? await insertPasskey(member.userId) : uuidv7();
    return removeOwn({ headers }, id);
  });
});

test("resetting an admin of the organization", async () => {
  await expectStatuses(
    cast,
    {
      platformAdmin: 204,
      organizationAdmin: 204,
      organizationAdminOtherOrganization: 404,
      coordinator: 404,
      volunteer: 404,
      volunteerOtherGroup: 404,
      coordinatorOtherOrganization: 404,
      applicant: 404,
      anonymous: 401,
    },
    async (headers) => {
      const target = await newOrganizationAdmin();
      return resetOrganizationAdmin({ headers }, cast.organization.id, target.userId);
    },
  );
});

test("resetting a platform admin", async () => {
  await expectStatuses(
    cast,
    {
      platformAdmin: 204,
      organizationAdmin: 403,
      coordinator: 403,
      volunteer: 403,
      volunteerOtherGroup: 403,
      coordinatorOtherOrganization: 403,
      organizationAdminOtherOrganization: 403,
      applicant: 403,
      anonymous: 401,
    },
    async (headers) => {
      const target = await newPlatformAdmin();
      return resetPlatformAdmin({ headers }, target.userId);
    },
  );
});

test("an organization admin cannot reset a platform admin who is also an admin of the organization: 403", async () => {
  const target = await newPlatformAdmin();
  await grantOrganizationAdmin(
    ctx.t.db,
    { email: target.email, organizationId: cast.organization.id },
    system,
  );
  const res = await resetOrganizationAdmin(
    cast.members.organizationAdmin,
    cast.organization.id,
    target.userId,
  );
  expect(res.statusCode).toBe(403);
  expect(res.json().code).toBe("not_allowed");
  expect(await passkeysOf(target.userId)).toHaveLength(1);
  // A platform admin may.
  const byPlatform = await resetOrganizationAdmin(
    cast.members.platformAdmin,
    cast.organization.id,
    target.userId,
  );
  expect(byPlatform.statusCode).toBe(204);
});

test("resetting yourself is 409 own_account on both routes, and your passkeys stay", async () => {
  const platform = cast.members.platformAdmin;
  const admin = cast.members.organizationAdmin;
  await insertPasskey(platform.userId);
  await insertPasskey(admin.userId);
  const byPlatform = await resetPlatformAdmin(platform, platform.userId);
  expect(byPlatform.statusCode).toBe(409);
  expect(byPlatform.json().code).toBe("own_account");
  const byOrganization = await resetOrganizationAdmin(admin, cast.organization.id, admin.userId);
  expect(byOrganization.statusCode).toBe(409);
  expect(byOrganization.json().code).toBe("own_account");
  expect((await passkeysOf(platform.userId)).length).toBeGreaterThan(0);
  expect((await passkeysOf(admin.userId)).length).toBeGreaterThan(0);
});

test("someone who is no admin of the organization, or no platform admin, is 404", async () => {
  const stranger = await newPlatformAdmin();
  const ownerOfOther = cast.members.organizationAdminOtherOrganization;
  // An admin of another organization is no admin of this one.
  const wrongOrganization = await resetOrganizationAdmin(
    cast.members.platformAdmin,
    cast.organization.id,
    ownerOfOther.userId,
  );
  expect(wrongOrganization.statusCode).toBe(404);
  // A platform admin who is no admin of the organization is no target there either.
  const notThere = await resetOrganizationAdmin(
    cast.members.platformAdmin,
    cast.organization.id,
    stranger.userId,
  );
  expect(notThere.statusCode).toBe(404);
  // A volunteer is no platform admin.
  const notPlatform = await resetPlatformAdmin(
    cast.members.platformAdmin,
    cast.members.volunteer.userId,
  );
  expect(notPlatform.statusCode).toBe(404);
  expect((await passkeysOf(stranger.userId)).length).toBe(1);
});

test("the list is passkey_required at 24 h; a removal and a reset are passkey_required at 10 min", async () => {
  const admin = await newOrganizationAdmin();
  const target = await newOrganizationAdmin();
  const minutes = (m: number) => new Date(Date.now() - m * 60_000);

  await stampSession(ctx, admin.headers.cookie, minutes(11));
  expect((await list(admin)).statusCode).toBe(200);
  const removal = await removeOwn(admin, admin.passkeyId);
  expect(removal.statusCode).toBe(403);
  expect(removal.json().code).toBe("passkey_required");
  const reset = await resetOrganizationAdmin(admin, cast.organization.id, target.userId);
  expect(reset.statusCode).toBe(403);
  expect(reset.json().code).toBe("passkey_required");
  expect(await passkeysOf(admin.userId)).toHaveLength(1);
  expect(await passkeysOf(target.userId)).toHaveLength(1);

  await stampSession(ctx, admin.headers.cookie, new Date(Date.now() - 25 * 3_600_000));
  const old = await list(admin);
  expect(old.statusCode).toBe(403);
  expect(old.json().code).toBe("passkey_required");
});

test("a reset clears the confirmation of all the person's sessions: their next GET /api/passkeys is passkey_required", async () => {
  const target = await newOrganizationAdmin();
  expect((await list(target)).statusCode).toBe(200);
  const res = await resetOrganizationAdmin(
    cast.members.platformAdmin,
    cast.organization.id,
    target.userId,
  );
  expect(res.statusCode).toBe(204);
  const after = await list(target);
  expect(after.statusCode).toBe(403);
  expect(after.json().code).toBe("passkey_required");
  const rows = await ctx.t.db.select().from(sessions).where(eq(sessions.userId, target.userId));
  expect(rows.every((row) => row.passkeyVerifiedAt === null)).toBe(true);
});

test("removing someone else's passkey by ID is 404 and it stays", async () => {
  const other = await newOrganizationAdmin();
  const res = await removeOwn(cast.members.organizationAdmin, other.passkeyId);
  expect(res.statusCode).toBe(404);
  expect(await passkeysOf(other.userId)).toHaveLength(1);
  const missing = await removeOwn(cast.members.organizationAdmin, uuidv7());
  expect(missing.statusCode).toBe(404);
  const invalid = await removeOwn(cast.members.organizationAdmin, "not-a-uuid");
  expect(invalid.statusCode).toBe(400);
});

test("the list holds id, createdAt and backedUp, and no key material", async () => {
  const admin = await newOrganizationAdmin();
  const res = await list(admin);
  expect(res.statusCode).toBe(200);
  const body = res.json() as { passkeys: Record<string, unknown>[] };
  expect(body.passkeys).toHaveLength(1);
  expect(Object.keys(body.passkeys[0]!).sort()).toEqual(["backedUp", "createdAt", "id"]);
  expect(body.passkeys[0]!.id).toBe(admin.passkeyId);
  expect(body.passkeys[0]!.backedUp).toBe(true);
  expect(body.passkeys[0]!.createdAt).toMatch(/Z$|[+-]\d\d:\d\d$/);
  for (const secret of ["publicKey", "credentialID", "counter", "aaguid", "public-key-"]) {
    expect(res.body).not.toContain(secret);
  }
});

test("a reset writes passkey.reset with the organization of the path, or none on the platform route", async () => {
  const target = await newOrganizationAdmin();
  await resetOrganizationAdmin(cast.members.organizationAdmin, cast.organization.id, target.userId);
  const platformTarget = await newPlatformAdmin();
  await resetPlatformAdmin(cast.members.platformAdmin, platformTarget.userId);

  const entry = async (subjectId: string) =>
    (
      await ctx.t.db
        .select()
        .from(auditLogEntries)
        .where(
          and(
            eq(auditLogEntries.subjectId, subjectId),
            eq(auditLogEntries.action, "passkey.reset"),
          ),
        )
    )[0];
  const first = await entry(target.userId);
  expect(first?.organizationId).toBe(cast.organization.id);
  expect(first?.actorUserId).toBe(cast.members.organizationAdmin.userId);
  const second = await entry(platformTarget.userId);
  expect(second?.organizationId).toBeNull();
  expect(second?.actorUserId).toBe(cast.members.platformAdmin.userId);
  // Both queued the mail by IDs only.
  const jobs = ctx.mailQueue.jobs.filter((job) => job.kind === "passkeys-removed");
  expect(jobs.map((job) => job.userId)).toEqual(
    expect.arrayContaining([target.userId, platformTarget.userId]),
  );
});

test("removing the last own passkey leaves hasPasskey false", async () => {
  const admin = await newOrganizationAdmin();
  const hasPasskey = async () =>
    (await send(admin, "GET", "/api/me")).json().user.hasPasskey as boolean;
  expect(await hasPasskey()).toBe(true);
  expect((await removeOwn(admin, admin.passkeyId)).statusCode).toBe(204);
  expect(await hasPasskey()).toBe(false);
  expect((await list(admin)).json()).toEqual({ passkeys: [] });
});
