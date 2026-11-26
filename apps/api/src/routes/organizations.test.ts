import {
  auditLogEntries,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  organizationAdmins,
  organizations,
  passkeys,
  users,
  workingGroupMemberships,
} from "@padvinder/db";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import { testEnv } from "../test-env";
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

type Headers = Record<string, string>;
type Who = CastLogin | { headers: Headers };
const send = (
  who: Who,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) => ctx.app.inject({ method, url, headers: who.headers, payload });
const post = (who: Who, payload: object) => send(who, "POST", "/api/organizations", payload);
const patch = (who: Who, id: string, payload: object) =>
  send(who, "PATCH", `/api/organizations/${id}`, payload);
const addAdmin = (who: Who, id: string, email: string) =>
  send(who, "POST", `/api/organizations/${id}/admins`, { email });
const removeAdmin = (who: Who, id: string, userId: string) =>
  send(who, "DELETE", `/api/organizations/${id}/admins/${userId}`);

let n = 0;
const uniqueName = () => `Testorganisatie ${++n} ${uuidv7().slice(-8)}`;
const uniqueAddress = (label: string) => `${label}-${++n}-${uuidv7().slice(-8)}@example.test`;
const newBody = (extra: Record<string, unknown> = {}) => ({
  name: uniqueName(),
  adminEmail: uniqueAddress("eerste"),
  ...extra,
});
/** An organization made by the platform admin; returns its detail. */
async function makeOrganization(extra: Record<string, unknown> = {}) {
  const res = await post(cast.members.platformAdmin, newBody(extra));
  expect(res.statusCode).toBe(201);
  return res.json() as {
    id: string;
    name: string;
    contactEmail: string | null;
    admins: { userId: string; email: string }[];
  };
}

const everyone = {
  platformAdmin: 200,
  organizationAdmin: 200,
  coordinator: 200,
  volunteer: 200,
  volunteerOtherGroup: 200,
  coordinatorOtherOrganization: 200,
  organizationAdminOtherOrganization: 200,
  applicant: 200,
  anonymous: 401,
};
const adminsOfIt = (ok: number, admin = ok) => ({
  platformAdmin: ok,
  organizationAdmin: admin,
  coordinator: 404,
  volunteer: 404,
  volunteerOtherGroup: 404,
  coordinatorOtherOrganization: 404,
  organizationAdminOtherOrganization: 404,
  applicant: 404,
  anonymous: 401,
});
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

test("everyone logged in gets their own list", async () =>
  await expectStatuses(cast, everyone, (headers) =>
    ctx.app.inject({ url: "/api/organizations", headers }),
  ));

test("the list holds all for a platform admin, one for an admin, none for a coordinator", async () => {
  const names = async (who: CastLogin) =>
    ((await send(who, "GET", "/api/organizations")).json().organizations as { id: string }[]).map(
      (o) => o.id,
    );
  const all = await names(cast.members.platformAdmin);
  expect(all).toContain(cast.organization.id);
  expect(all).toContain(cast.otherOrganization.id);
  expect(await names(cast.members.organizationAdmin)).toEqual([cast.organization.id]);
  expect(await names(cast.members.coordinator)).toEqual([]);
  expect(await names(cast.members.applicant)).toEqual([]);
  const row = (await send(cast.members.organizationAdmin, "GET", "/api/organizations")).json()
    .organizations[0];
  expect(Object.keys(row).sort()).toEqual(["contactEmail", "id", "name"]);
});

test("only its admins and platform admins see an organization", async () => {
  await expectStatuses(cast, adminsOfIt(200), (headers) =>
    ctx.app.inject({ url: `/api/organizations/${cast.organization.id}`, headers }),
  );
  const res = await send(
    cast.members.organizationAdmin,
    "GET",
    `/api/organizations/${cast.organization.id}`,
  );
  expect(res.json()).toEqual({
    id: cast.organization.id,
    name: "Cast Organisatie",
    contactEmail: null,
    admins: [
      {
        userId: cast.members.organizationAdmin.userId,
        name: "Cast organizationAdmin",
        email: cast.members.organizationAdmin.email.toLowerCase(),
        hasLoggedIn: true,
        hasPasskey: false,
        mayResetPasskeys: false,
      },
    ],
  });
});

test("only a platform admin creates an organization", async () =>
  await expectStatuses(cast, platformOnly(201), (headers) => post({ headers }, newBody())));

test("its admin changes the contact address", async () =>
  await expectStatuses(cast, adminsOfIt(200), (headers) =>
    patch({ headers }, cast.organization.id, { contactEmail: "contact@example.test" }),
  ));

test("only a platform admin renames it", async () => {
  const { id } = await makeOrganization();
  // The organization admin is not an admin of this one: use the cast organization for the admin.
  await expectStatuses(cast, adminsOfIt(200, 403), (headers) =>
    patch({ headers }, cast.organization.id, { name: "Cast Organisatie" }),
  );
  const res = await patch(cast.members.platformAdmin, id, { name: uniqueName() });
  expect(res.statusCode).toBe(200);
});

test("a body with name and contactEmail from its admin changes nothing", async () => {
  await patch(cast.members.platformAdmin, cast.organization.id, {
    contactEmail: "vast@example.test",
  });
  const res = await patch(cast.members.organizationAdmin, cast.organization.id, {
    name: uniqueName(),
    contactEmail: "nieuw@example.test",
  });
  expect(res.statusCode).toBe(403);
  const [row] = await ctx.t.db
    .select()
    .from(organizations)
    .where(eq(organizations.id, cast.organization.id));
  expect(row).toMatchObject({ name: "Cast Organisatie", contactEmail: "vast@example.test" });
});

test("only a platform admin appoints an admin", async () =>
  await expectStatuses(cast, adminsOfIt(200, 403), (headers) =>
    addAdmin({ headers }, cast.organization.id, uniqueAddress("beheerder")),
  ));

test("only a platform admin removes an admin", async () => {
  const org = await makeOrganization();
  const second = await addAdmin(cast.members.platformAdmin, org.id, uniqueAddress("tweede"));
  expect(second.statusCode).toBe(200);
  const spare = async () => {
    const res = await addAdmin(cast.members.platformAdmin, org.id, uniqueAddress("extra"));
    const admins = res.json().admins as { email: string; userId: string }[];
    return admins[admins.length - 1]!;
  };
  // Each call needs its own admin to remove; the statuses of 403 and 404 do not remove anyone.
  const expected = adminsOfIt(204, 403);
  const who = [...Object.keys(cast.members), "anonymous"] as (keyof typeof expected)[];
  for (const name of who) {
    const headers = name === "anonymous" ? {} : cast.members[name].headers;
    const target = await spare();
    const res = await removeAdmin({ headers }, org.id, target.userId);
    // The cast has no admin of this fresh organization: only a platform admin passes.
    const want = name === "platformAdmin" ? 204 : name === "anonymous" ? 401 : 404;
    expect(res.statusCode, name).toBe(want);
  }
  // On the cast organization the admin of it is refused with 403, not 404.
  const own = await removeAdmin(
    cast.members.organizationAdmin,
    cast.organization.id,
    cast.members.organizationAdmin.userId,
  );
  expect(own.statusCode).toBe(403);
});

test("creating makes the first admin, also for an address without an account", async () => {
  const adminEmail = uniqueAddress("nieuw");
  const res = await post(cast.members.platformAdmin, {
    name: uniqueName(),
    adminEmail: `  ${adminEmail.toUpperCase()} `,
    contactEmail: "Contact@Example.test",
  });
  expect(res.statusCode).toBe(201);
  expect(res.json()).toMatchObject({
    contactEmail: "contact@example.test",
    admins: [{ email: adminEmail, name: "", hasLoggedIn: false }],
  });
  const [account] = await ctx.t.db.select().from(users).where(eq(users.email, adminEmail));
  expect(account).toBeDefined();
  const rows = await ctx.t.db
    .select()
    .from(organizationAdmins)
    .where(eq(organizationAdmins.organizationId, res.json().id));
  expect(rows).toHaveLength(1);
});

test("a taken name in other capitals is 409 name_taken on name, and no second organization", async () => {
  const org = await makeOrganization();
  for (const name of [org.name.toUpperCase(), `  ${org.name.replace(" ", "   ")} `]) {
    const res = await post(cast.members.platformAdmin, newBody({ name }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: "name_taken",
      issues: [{ path: "name", message: expect.any(String) }],
    });
  }
  const rows = await ctx.t.db.select().from(organizations);
  expect(rows.filter((row) => row.name.toLowerCase() === org.name.toLowerCase())).toHaveLength(1);

  const other = await makeOrganization();
  const renamed = await patch(cast.members.platformAdmin, other.id, {
    name: org.name.toLowerCase(),
  });
  expect(renamed.statusCode).toBe(409);
  expect(renamed.json()).toMatchObject({ code: "name_taken", issues: [{ path: "name" }] });
});

test.each([
  { name: "X", adminEmail: "jan@" },
  { name: " ", adminEmail: "jan@example.test" },
  { name: "X" },
  { name: "X", adminEmail: "jan@example.test", extra: 1 },
  { name: "a@b", adminEmail: "jan@example.test" },
])("create rejects %j with 400", async (body) => {
  const res = await post(cast.members.platformAdmin, body);
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ code: "invalid_request" });
});

test("the address of a deleted account is 400 with an issue on adminEmail", async () => {
  const name = uniqueName();
  const res = await post(cast.members.platformAdmin, {
    name,
    adminEmail: "deleted-0192f3c0@deleted.invalid",
  });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({
    code: "invalid_request",
    issues: [{ path: "adminEmail" }],
  });
  const rows = await ctx.t.db.select().from(organizations).where(eq(organizations.name, name));
  expect(rows).toHaveLength(0);
});

test("removing the last admin is 409 last_organization_admin", async () => {
  const res = await removeAdmin(
    cast.members.platformAdmin,
    cast.otherOrganization.id,
    cast.members.organizationAdminOtherOrganization.userId,
  );
  expect(res.statusCode).toBe(409);
  expect(res.json()).toMatchObject({ code: "last_organization_admin" });
});

test("removing someone who is no admin there is 404", async () => {
  const res = await removeAdmin(
    cast.members.platformAdmin,
    cast.organization.id,
    cast.members.volunteer.userId,
  );
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ code: "not_found" });
});

test("appointing the same admin twice answers 200 twice and writes one entry", async () => {
  const org = await makeOrganization();
  const email = uniqueAddress("dubbel");
  const first = await addAdmin(cast.members.platformAdmin, org.id, email);
  const again = await addAdmin(cast.members.platformAdmin, org.id, ` ${email.toUpperCase()}`);
  expect(first.statusCode).toBe(200);
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual(first.json());
  expect(first.json().admins).toHaveLength(2);
  const entries = await ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(
      and(
        eq(auditLogEntries.organizationId, org.id),
        eq(auditLogEntries.action, "role.organization_admin_granted"),
      ),
    );
  expect(entries).toHaveLength(2); // the first admin at creation, and this one
});

test("an address of a deleted account or no address cannot be appointed", async () => {
  const org = await makeOrganization();
  for (const email of ["x@deleted.invalid", "geen-adres"]) {
    const res = await addAdmin(cast.members.platformAdmin, org.id, email);
    expect(res.statusCode, email).toBe(400);
    expect(res.json()).toMatchObject({ code: "invalid_request", issues: [{ path: "email" }] });
  }
});

test("the audit entries name the platform admin as actor", async () => {
  const admin = cast.members.platformAdmin;
  const org = await makeOrganization();
  await patch(admin, org.id, { contactEmail: "a@example.test" });
  const entries = await ctx.t.db
    .select()
    .from(auditLogEntries)
    .where(
      and(eq(auditLogEntries.subjectType, "organization"), eq(auditLogEntries.subjectId, org.id)),
    );
  expect(entries.map((entry) => entry.action).sort()).toEqual([
    "organization.created",
    "organization.updated",
  ]);
  for (const entry of entries) {
    expect(entry).toMatchObject({ actorKind: "user", actorUserId: admin.userId });
  }
});

test("contactEmail null empties it; an empty PATCH body and an unknown key are 400", async () => {
  const admin = cast.members.platformAdmin;
  const org = await makeOrganization({ contactEmail: "contact@example.test" });
  const emptied = await patch(admin, org.id, { contactEmail: null });
  expect(emptied.statusCode).toBe(200);
  expect(emptied.json().contactEmail).toBeNull();
  const again = await patch(admin, org.id, { contactEmail: null });
  expect(again.json()).toEqual(emptied.json());
  expect((await patch(admin, org.id, {})).statusCode).toBe(400);
  expect((await patch(admin, org.id, { color: "red" })).statusCode).toBe(400);
  expect((await patch(admin, org.id, { contactEmail: "geen" })).statusCode).toBe(400);
});

test("an unknown organization is 404; an id that is not a UUID is 400", async () => {
  const admin = cast.members.platformAdmin;
  for (const res of [
    await send(admin, "GET", `/api/organizations/${uuidv7()}`),
    await patch(admin, uuidv7(), { contactEmail: null }),
    await addAdmin(admin, uuidv7(), "x@example.test"),
    await removeAdmin(admin, uuidv7(), uuidv7()),
  ]) {
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  }
  const notUuid = await send(admin, "GET", "/api/organizations/abc");
  expect(notUuid.statusCode).toBe(400);
  expect(notUuid.json()).toMatchObject({ code: "invalid_request" });
});

test("a POST from a foreign Origin is refused", async () => {
  const body = newBody();
  const res = await post(
    { headers: { ...cast.members.platformAdmin.headers, origin: "https://evil.example" } },
    body,
  );
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ code: "origin_not_allowed" });
  const rows = await ctx.t.db.select().from(organizations).where(eq(organizations.name, body.name));
  expect(rows).toHaveLength(0);
  const own = await post(
    { headers: { ...cast.members.platformAdmin.headers, origin: testEnv.PUBLIC_ORIGIN } },
    newBody(),
  );
  expect(own.statusCode).toBe(201);
});

/** The jobs queued while `act` runs. */
async function jobsQueuedBy(act: () => Promise<unknown>) {
  const before = ctx.mailQueue.jobs.length;
  await act();
  return ctx.mailQueue.jobs.slice(before);
}

test("creating an organization queues one job with IDs only", async () => {
  let res: Awaited<ReturnType<typeof post>> | undefined;
  const jobs = await jobsQueuedBy(async () => {
    res = await post(cast.members.platformAdmin, newBody());
  });
  expect(res!.statusCode).toBe(201);
  expect(jobs).toEqual([
    {
      kind: "organization-admin",
      userId: expect.any(String),
      organizationId: expect.any(String),
    },
  ]);
  expect(jobs[0]).toEqual({
    kind: "organization-admin",
    userId: res!.json().admins[0].userId,
    organizationId: res!.json().id,
  });
});

test("a platform admin who names themself as first admin gets no mail", async () => {
  const jobs = await jobsQueuedBy(async () => {
    const res = await post(cast.members.platformAdmin, {
      name: uniqueName(),
      adminEmail: cast.members.platformAdmin.email,
    });
    expect(res.statusCode).toBe(201);
  });
  expect(jobs).toEqual([]);
});

test("appointing an admin queues one job, appointing them again none", async () => {
  const org = await makeOrganization();
  const email = uniqueAddress("benoemd");
  let userId = "";
  const first = await jobsQueuedBy(async () => {
    const res = await addAdmin(cast.members.platformAdmin, org.id, email);
    expect(res.statusCode).toBe(200);
    userId = (res.json() as { admins: { userId: string; email: string }[] }).admins.find(
      (admin) => admin.email === email,
    )!.userId;
  });
  expect(first).toEqual([{ kind: "organization-admin", userId, organizationId: org.id }]);
  const again = await jobsQueuedBy(async () => {
    expect((await addAdmin(cast.members.platformAdmin, org.id, email)).statusCode).toBe(200);
  });
  expect(again).toEqual([]);
});

test("a refused or failed request queues nothing", async () => {
  const org = await makeOrganization();
  const jobs = await jobsQueuedBy(async () => {
    expect((await post(cast.members.organizationAdmin, newBody())).statusCode).toBe(403);
    expect((await post(cast.members.platformAdmin, newBody({ name: org.name }))).statusCode).toBe(
      409,
    );
    expect(
      (await addAdmin(cast.members.organizationAdmin, org.id, uniqueAddress("x"))).statusCode,
    ).toBe(404);
  });
  expect(jobs).toEqual([]);
});

test("a new working group queues first-coordinator; making a member coordinator queues nothing", async () => {
  const organizationId = cast.organization.id;
  const admin = cast.members.organizationAdmin;
  let group = { id: "" };
  const created = await jobsQueuedBy(async () => {
    const res = await send(admin, "POST", `/api/organizations/${organizationId}/working-groups`, {
      name: uniqueName(),
      city: "Enschede",
      coordinatorEmail: uniqueAddress("eerste"),
    });
    expect(res.statusCode).toBe(201);
    group = res.json();
  });
  const [coordinatorMembership] = await ctx.t.db
    .select({ id: workingGroupMemberships.id })
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, group.id));
  expect(created).toEqual([
    {
      kind: "first-coordinator",
      membershipId: coordinatorMembership!.id,
      byUserId: admin.userId,
    },
  ]);

  const own = await jobsQueuedBy(async () => {
    const res = await send(admin, "POST", `/api/organizations/${organizationId}/working-groups`, {
      name: uniqueName(),
      city: "Enschede",
      coordinatorEmail: admin.email,
    });
    expect(res.statusCode).toBe(201);
  });
  expect(own).toEqual([]);

  const [volunteer] = await ctx.t.db
    .insert(workingGroupMemberships)
    .values({
      userId: cast.members.volunteerOtherGroup.userId,
      workingGroupId: group.id,
      isCoordinator: false,
    })
    .returning({ id: workingGroupMemberships.id });
  const raised = await jobsQueuedBy(async () => {
    const res = await send(admin, "PATCH", `/api/memberships/${volunteer!.id}`, {
      isCoordinator: true,
    });
    expect(res.statusCode).toBe(200);
  });
  expect(raised).toEqual([]);
});

test("each admin shows hasPasskey; mayResetPasskeys is false for yourself and for a platform admin when you are an organization admin", async () => {
  const system = { kind: "system" } as const;
  const organization = cast.otherOrganization.id;
  const plain = await loginAs(ctx, `plain-admin-${uuidv7().slice(-8)}@example.test`, {
    name: "Gewone Beheerder",
  });
  const platform = await loginAs(ctx, `platform-admin-${uuidv7().slice(-8)}@example.test`, {
    name: "Hoofd Beheerder",
  });
  const plainEmail = (await ctx.t.db.select().from(users).where(eq(users.id, plain.userId)))[0]!
    .email;
  const platformEmail = (
    await ctx.t.db.select().from(users).where(eq(users.id, platform.userId))
  )[0]!.email;
  await grantOrganizationAdmin(
    ctx.t.db,
    { email: plainEmail, organizationId: organization },
    system,
  );
  await grantOrganizationAdmin(
    ctx.t.db,
    { email: platformEmail, organizationId: organization },
    system,
  );
  await grantPlatformAdmin(ctx.t.db, { email: platformEmail }, system);
  await stampSession(ctx, plain.headers.cookie, new Date());
  await stampSession(ctx, platform.headers.cookie, new Date());
  await ctx.t.db.insert(passkeys).values({
    userId: plain.userId,
    publicKey: "pk",
    credentialID: `cred-${uuidv7()}`,
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
  });

  type Row = { userId: string; hasPasskey: boolean; mayResetPasskeys: boolean };
  const admins = async (who: Who) =>
    new Map(
      (
        (await send(who, "GET", `/api/organizations/${organization}`)).json() as { admins: Row[] }
      ).admins.map((admin) => [admin.userId, admin]),
    );

  // The organization's own admin (recently confirmed) may reset the plain admin only.
  const own = cast.members.organizationAdminOtherOrganization;
  const seenByAdmin = await admins(own);
  expect(seenByAdmin.get(own.userId)).toMatchObject({ hasPasskey: false, mayResetPasskeys: false });
  expect(seenByAdmin.get(plain.userId)).toMatchObject({ hasPasskey: true, mayResetPasskeys: true });
  expect(seenByAdmin.get(platform.userId)).toMatchObject({
    hasPasskey: false,
    mayResetPasskeys: false,
  });

  // A platform admin may reset every admin but themself.
  const seenByPlatform = await admins(cast.members.platformAdmin);
  expect(seenByPlatform.get(plain.userId)?.mayResetPasskeys).toBe(true);
  expect(seenByPlatform.get(platform.userId)?.mayResetPasskeys).toBe(true);
  expect(seenByPlatform.get(own.userId)?.mayResetPasskeys).toBe(true);
  const seenByThemself = await admins(platform);
  expect(seenByThemself.get(platform.userId)?.mayResetPasskeys).toBe(false);
});

test("the organization answer never says who is a platform admin", async () => {
  const res = await send(
    cast.members.platformAdmin,
    "GET",
    `/api/organizations/${cast.organization.id}`,
  );
  expect(res.statusCode).toBe(200);
  expect(res.body).not.toContain("isPlatformAdmin");
  const admin = res.json().admins[0] as Record<string, unknown>;
  expect(Object.keys(admin).sort()).toEqual([
    "email",
    "hasLoggedIn",
    "hasPasskey",
    "mayResetPasskeys",
    "name",
    "userId",
  ]);
});
