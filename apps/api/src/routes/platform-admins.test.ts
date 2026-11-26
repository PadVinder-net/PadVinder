import { auditLogEntries, deleteAccount, grantPlatformAdmin, passkeys, users } from "@padvinder/db";
import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import { testEnv } from "../test-env";
import { createCast, expectStatuses, type Cast, type CastLogin } from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";

let ctx: TestApp;
let cast: Cast;
beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);
});
afterAll(() => ctx.close());

type Headers = Record<string, string>;
type Who = CastLogin | { headers: Headers };
const list = (who: Who) =>
  ctx.app.inject({ method: "GET", url: "/api/platform-admins", headers: who.headers });
const appoint = (who: Who, payload: object) =>
  ctx.app.inject({ method: "POST", url: "/api/platform-admins", headers: who.headers, payload });
const remove = (who: Who, userId: string) =>
  ctx.app.inject({
    method: "DELETE",
    url: `/api/platform-admins/${userId}`,
    headers: who.headers,
  });

let n = 0;
const uniqueAddress = (label: string) => `${label}-${++n}-${uuidv7().slice(-8)}@example.test`;

type Row = {
  userId: string;
  name: string;
  email: string;
  hasLoggedIn: boolean;
  hasPasskey: boolean;
};
const rows = (res: { json: () => unknown }) =>
  (res.json() as { platformAdmins: Row[] }).platformAdmins;

const platformOnly = (ok: number) => ({
  platformAdmin: ok,
  organizationAdmin: 403,
  coordinator: 403,
  volunteer: 403,
  volunteerOtherGroup: 403,
  coordinatorOtherOrganization: 403,
  organizationAdminOtherOrganization: 403,
  applicant: 403,
  anonymous: 401,
});

/** A platform admin appointed by the cast's platform admin, who never logged in. */
async function appointed(): Promise<Row> {
  const email = uniqueAddress("hoofd");
  const res = await appoint(cast.members.platformAdmin, { email });
  expect(res.statusCode).toBe(200);
  return rows(res).find((row) => row.email === email)!;
}

const accountsWith = (email: string) => ctx.t.db.select().from(users).where(eq(users.email, email));

test("only a platform admin lists them", async () => {
  await expectStatuses(cast, platformOnly(200), (headers) => list({ headers }));
  const res = await list(cast.members.platformAdmin);
  const own = rows(res).find((row) => row.userId === cast.members.platformAdmin.userId);
  expect(own).toEqual({
    userId: cast.members.platformAdmin.userId,
    name: "Cast platformAdmin",
    email: cast.members.platformAdmin.email.toLowerCase(),
    hasLoggedIn: true,
    hasPasskey: false,
  });
  for (const row of rows(res)) {
    expect(Object.keys(row).sort()).toEqual([
      "email",
      "hasLoggedIn",
      "hasPasskey",
      "name",
      "userId",
    ]);
  }
});

test("only a platform admin appoints one", async () =>
  await expectStatuses(cast, platformOnly(200), (headers) =>
    appoint({ headers }, { email: uniqueAddress("benoemd") }),
  ));

test("only a platform admin removes one", async () =>
  await expectStatuses(cast, platformOnly(204), async (headers) => {
    const target = await appointed();
    return remove({ headers }, target.userId);
  }));

test("a refused appointment makes no account and no platform admin", async () => {
  for (const who of [cast.members.volunteer, cast.members.organizationAdmin, { headers: {} }]) {
    const email = uniqueAddress("geweigerd");
    const res = await appoint(who, { email });
    expect([401, 403]).toContain(res.statusCode);
    expect(await accountsWith(email)).toEqual([]);
  }
  const res = await appoint(cast.members.volunteer, { email: cast.members.applicant.email });
  expect(res.statusCode).toBe(403);
  const [applicant] = await accountsWith(cast.members.applicant.email);
  expect(applicant?.isPlatformAdmin).toBe(false);
});

test("appointing ' Nieuw@Example.TEST ' makes the account nieuw@example.test, shown as never logged in", async () => {
  const res = await appoint(cast.members.platformAdmin, { email: " Nieuw@Example.TEST " });
  expect(res.statusCode).toBe(200);
  const [account] = await accountsWith("nieuw@example.test");
  expect(account).toMatchObject({ name: "", isPlatformAdmin: true, emailVerified: false });
  expect(rows(res)).toContainEqual({
    userId: account!.id,
    name: "",
    email: "nieuw@example.test",
    hasLoggedIn: false,
    hasPasskey: false,
  });
});

test("appointing the same address twice answers 200 twice and writes one entry, with the platform admin as actor", async () => {
  const email = uniqueAddress("dubbel");
  const first = await appoint(cast.members.platformAdmin, { email });
  const again = await appoint(cast.members.platformAdmin, { email: ` ${email.toUpperCase()}` });
  expect(first.statusCode).toBe(200);
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual(first.json());
  const [account] = await accountsWith(email);
  const entries = await ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(
      and(
        eq(auditLogEntries.subjectId, account!.id),
        eq(auditLogEntries.action, "role.platform_admin_granted"),
      ),
    );
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    actorKind: "user",
    actorUserId: cast.members.platformAdmin.userId,
    organizationId: null,
  });
});

test.each([{ email: "jan@" }, {}, { email: "jan@example.test", extra: 1 }])(
  "appointing with %j is 400",
  async (body) => {
    const res = await appoint(cast.members.platformAdmin, body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "invalid_request" });
    expect(await accountsWith("jan@example.test")).toEqual([]);
  },
);

test("the address of a deleted account is 400 with an issue on email", async () => {
  const leaving = await loginAs(ctx, uniqueAddress("weg"));
  expect(await deleteAccount(ctx.t.db, { userId: leaving.userId, now: new Date() })).toMatchObject({
    outcome: "deleted",
  });
  const [deleted] = await ctx.t.db.select().from(users).where(eq(users.id, leaving.userId));
  const email = deleted!.email;
  expect(email).toMatch(/@deleted\.invalid$/);
  const res = await appoint(cast.members.platformAdmin, { email });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ code: "invalid_request", issues: [{ path: "email" }] });
  // Only the deleted account has the address, and it got no flag.
  expect(await accountsWith(email)).toMatchObject([{ id: leaving.userId, isPlatformAdmin: false }]);
});

test("the only platform admin who logged in cannot remove themself: 409 last_platform_admin, and the flag stays", async () => {
  const self = cast.members.platformAdmin;
  const loggedInPlatformAdmins = await ctx.t.db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.isPlatformAdmin, true), eq(users.emailVerified, true), isNull(users.deletedAt)),
    );
  expect(
    loggedInPlatformAdmins.map((row) => row.id),
    "an earlier test left another platform admin who logged in; this test needs the cast's to be the only one",
  ).toEqual([self.userId]);
  // A platform admin who never logged in does not count.
  await appointed();
  const res = await remove(self, self.userId);
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ code: "last_platform_admin" });
  const [account] = await ctx.t.db.select().from(users).where(eq(users.id, self.userId));
  expect(account?.isPlatformAdmin).toBe(true);
  expect((await list(self)).statusCode).toBe(200);
});

/** The `role.platform_admin_revoked` entries about this user. */
const revokedEntries = (userId: string) =>
  ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(
      and(
        eq(auditLogEntries.subjectId, userId),
        eq(auditLogEntries.action, "role.platform_admin_revoked"),
      ),
    );

test("removing one writes one entry, with the removing platform admin as actor", async () => {
  const target = await appointed();
  expect((await remove(cast.members.platformAdmin, target.userId)).statusCode).toBe(204);
  expect((await remove(cast.members.platformAdmin, target.userId)).statusCode).toBe(404);
  const entries = await revokedEntries(target.userId);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    actorKind: "user",
    actorUserId: cast.members.platformAdmin.userId,
    organizationId: null,
    subjectType: "user",
  });
});

test("with a second platform admin who logged in, someone removes themself, and their next list is 403", async () => {
  const email = uniqueAddress("tweede");
  const second = await loginAs(ctx, email, { name: "Tweede Hoofdbeheerder" });
  await grantPlatformAdmin(ctx.t.db, { email }, { kind: "system" });
  expect((await list(second)).statusCode).toBe(200);
  const res = await remove(second, second.userId);
  expect(res.statusCode).toBe(204);
  const entries = await revokedEntries(second.userId);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ actorKind: "user", actorUserId: second.userId });
  expect((await list(second)).statusCode).toBe(403);
  const after = rows(await list(cast.members.platformAdmin));
  expect(after.map((row) => row.userId)).not.toContain(second.userId);
  expect(after.map((row) => row.userId)).toContain(cast.members.platformAdmin.userId);
});

test("removing a user who is no platform admin, or an unknown id, is 404; an id that is not a UUID is 400", async () => {
  const admin = cast.members.platformAdmin;
  for (const userId of [cast.members.volunteer.userId, uuidv7()]) {
    const res = await remove(admin, userId);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  }
  const notUuid = await remove(admin, "abc");
  expect(notUuid.statusCode).toBe(400);
  expect(notUuid.json()).toMatchObject({ code: "invalid_request" });
});

test("a POST from a foreign Origin is refused", async () => {
  const email = uniqueAddress("vreemd");
  const res = await appoint(
    { headers: { ...cast.members.platformAdmin.headers, origin: "https://evil.example" } },
    { email },
  );
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ code: "origin_not_allowed" });
  expect(await accountsWith(email)).toEqual([]);
  const own = await appoint(
    { headers: { ...cast.members.platformAdmin.headers, origin: testEnv.PUBLIC_ORIGIN } },
    { email },
  );
  expect(own.statusCode).toBe(200);
});

test("each platform admin shows hasPasskey", async () => {
  const email = uniqueAddress("platform-key");
  const login = await loginAs(ctx, email);
  await grantPlatformAdmin(ctx.t.db, { email }, { kind: "system" });
  const find = async () =>
    rows(await list(cast.members.platformAdmin)).find((row) => row.userId === login.userId);
  expect((await find())?.hasPasskey).toBe(false);
  await ctx.t.db.insert(passkeys).values({
    userId: login.userId,
    publicKey: "pk",
    credentialID: `cred-${uuidv7()}`,
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
  });
  expect((await find())?.hasPasskey).toBe(true);
});
