import type { LiveEvent } from "@padvinder/contracts";
import { asc, eq } from "drizzle-orm";
import pg from "pg";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  AdminError,
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  listOrganizations,
  lockOrganization,
  normalizeEmail,
  normalizeName,
  removeOrganizationAdmin,
  revokeCoordinator,
  revokeOrganizationAdmin,
  revokePlatformAdmin,
  updateOrganization,
} from "./admin";
import { getAccess } from "./access";
import { liveEventsChannel, notify } from "./notifications";
import type { AuditActor } from "./audit-log";
import {
  auditLogEntries,
  organizationAdmins,
  organizations,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

const system: AuditActor = { kind: "system" };
let t: TestDatabase | undefined;
// A fresh database per test: the audit log cannot be emptied.
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => {
  await t?.drop();
});

const db = () => t!.db;

async function setup() {
  const org = await createOrganization(
    db(),
    { name: "Paddentrek Enschede", adminEmail: "beheer@example.test" },
    system,
  );
  const group = await createWorkingGroup(
    db(),
    { organizationId: org.id, name: "Noord", city: "Enschede" },
    system,
  );
  return { orgId: org.id, groupId: group.id };
}

test("normalizeEmail trims and lowercases", () => {
  expect(normalizeEmail("  A@Example.TEST ")).toBe("a@example.test");
});

test("creates an organization and a working group, each with an audit entry", async () => {
  const { orgId, groupId } = await setup();
  const entries = await db().select().from(auditLogEntries);
  expect(entries.map((e) => e.action).sort()).toEqual([
    "organization.created",
    "role.organization_admin_granted",
    "working_group.created",
  ]);
  expect(entries.every((e) => e.organizationId === orgId)).toBe(true);
  expect(await listOrganizations(db())).toEqual([
    {
      id: orgId,
      name: "Paddentrek Enschede",
      hasAdmin: true,
      workingGroups: [{ id: groupId, name: "Noord", city: "Enschede", active: true }],
    },
  ]);
});

// The name check is case-sensitive, like the unique index it relies on.
test("a second working group with the same name in one organization is name_taken", async () => {
  const { orgId } = await setup();
  await expect(
    createWorkingGroup(db(), { organizationId: orgId, name: "Noord", city: "Hengelo" }, system),
  ).rejects.toMatchObject({ code: "name_taken" });
  expect(await db().select().from(auditLogEntries)).toHaveLength(3);
});

test("the same name in another organization is fine", async () => {
  await setup();
  const other = await createOrganization(
    db(),
    { name: "Andere", adminEmail: "andere@example.test" },
    system,
  );
  await expect(
    createWorkingGroup(db(), { organizationId: other.id, name: "Noord", city: "Hengelo" }, system),
  ).resolves.toHaveProperty("id");
});

test("granting platform admin to an unknown address creates the account", async () => {
  const { userId, changed } = await grantPlatformAdmin(
    db(),
    { email: "Eerste@Example.test" },
    system,
  );
  expect(changed).toBe(true);
  expect((await getAccess(db(), userId))?.isPlatformAdmin).toBe(true);
  expect(await db().select().from(users)).toMatchObject([
    { email: "eerste@example.test", name: "", emailVerified: false },
  ]);
});

test("the same grant again changes nothing and writes no second entry", async () => {
  await grantPlatformAdmin(db(), { email: "a@example.test" }, system);
  expect((await grantPlatformAdmin(db(), { email: " A@Example.TEST" }, system)).changed).toBe(
    false,
  );
  expect(await db().select().from(users)).toHaveLength(1);
  expect(await db().select().from(auditLogEntries)).toHaveLength(1);
});

test("two grants at once give one account and one entry", async () => {
  const results = await Promise.all([
    grantPlatformAdmin(db(), { email: "a@example.test" }, system),
    grantPlatformAdmin(db(), { email: "A@example.test" }, system),
  ]);
  expect(results.filter((r) => r.changed)).toHaveLength(1);
  expect(await db().select().from(users)).toHaveLength(1);
  expect(await db().select().from(auditLogEntries)).toHaveLength(1);
});

async function entries() {
  const rows = await db()
    .select()
    .from(auditLogEntries)
    .orderBy(asc(auditLogEntries.occurredAt), asc(auditLogEntries.id));
  return rows.map((e) => ({
    action: e.action,
    organizationId: e.organizationId,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    details: e.details,
  }));
}

/** What the first login does to an account the tool made: Better Auth verifies the address. */
async function logIn(email: string) {
  await db().update(users).set({ emailVerified: true }).where(eq(users.email, email));
}

test("the last platform admin cannot be revoked, and nothing is written", async () => {
  await grantPlatformAdmin(db(), { email: "a@example.test" }, system);
  const before = await entries();
  const attempt = revokePlatformAdmin(db(), { email: "a@example.test" }, system);
  await expect(attempt).rejects.toBeInstanceOf(AdminError);
  await expect(attempt).rejects.toMatchObject({ code: "last_platform_admin" });
  expect(await entries()).toEqual(before);
});

test("with two platform admins one can be revoked, with one entry", async () => {
  const a = await grantPlatformAdmin(db(), { email: "a@example.test" }, system);
  await grantPlatformAdmin(db(), { email: "b@example.test" }, system);
  await logIn("b@example.test");
  const result = await revokePlatformAdmin(db(), { email: "a@example.test" }, system);
  expect(result).toEqual({ userId: a.userId, changed: true });
  expect((await getAccess(db(), result.userId))?.isPlatformAdmin).toBe(false);
  const after = await entries();
  expect(after).toHaveLength(3);
  expect(after[2]).toEqual({
    action: "role.platform_admin_revoked",
    organizationId: null,
    subjectType: "user",
    subjectId: a.userId,
    details: {},
  });
  expect((await revokePlatformAdmin(db(), { email: "a@example.test" }, system)).changed).toBe(
    false,
  );
  expect(await entries()).toHaveLength(3);
});

test("a platform admin grant writes an entry without an organization", async () => {
  const a = await grantPlatformAdmin(db(), { email: "a@example.test" }, system);
  expect(await entries()).toEqual([
    {
      action: "role.platform_admin_granted",
      organizationId: null,
      subjectType: "user",
      subjectId: a.userId,
      details: {},
    },
  ]);
});

test("two revokes at once cannot remove the last two platform admins", async () => {
  await grantPlatformAdmin(db(), { email: "a@example.test" }, system);
  await grantPlatformAdmin(db(), { email: "b@example.test" }, system);
  await logIn("a@example.test");
  await logIn("b@example.test");
  const results = await Promise.allSettled([
    revokePlatformAdmin(db(), { email: "a@example.test" }, system),
    revokePlatformAdmin(db(), { email: "b@example.test" }, system),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await db().select().from(users).where(eq(users.isPlatformAdmin, true))).toHaveLength(1);
});

test("a platform admin who never logged in (a mistyped address) does not count", async () => {
  await grantPlatformAdmin(db(), { email: "a@example.test" }, system);
  await logIn("a@example.test");
  await grantPlatformAdmin(db(), { email: "admn@example.test" }, system);
  await expect(
    revokePlatformAdmin(db(), { email: "a@example.test" }, system),
  ).rejects.toMatchObject({ code: "last_platform_admin" });
  // The account nobody uses can go, because a platform admin who logged in stays.
  expect((await revokePlatformAdmin(db(), { email: "admn@example.test" }, system)).changed).toBe(
    true,
  );
});

test("grantCoordinator refuses an inactive working group, and writes nothing", async () => {
  const { groupId } = await setup();
  await db().update(workingGroups).set({ active: false }).where(eq(workingGroups.id, groupId));
  const before = await entries();
  await expect(
    grantCoordinator(db(), { email: "c@example.test", workingGroupId: groupId }, system),
  ).rejects.toMatchObject({ code: "working_group_inactive" });
  expect(await entries()).toEqual(before);
  expect(await db().select().from(workingGroupMemberships)).toHaveLength(0);
});

test("revoking for an unknown address is user_not_found", async () => {
  await expect(
    revokePlatformAdmin(db(), { email: "niemand@example.test" }, system),
  ).rejects.toMatchObject({ code: "user_not_found" });
});

test("grantCoordinator creates the membership, with one entry, and a repeat adds none", async () => {
  const { orgId, groupId } = await setup();
  const first = await grantCoordinator(
    db(),
    { email: "c@example.test", workingGroupId: groupId },
    system,
  );
  expect(first.changed).toBe(true);
  expect((await getAccess(db(), first.userId))?.memberships[0]?.isCoordinator).toBe(true);
  const granted = {
    action: "role.coordinator_granted",
    organizationId: orgId,
    subjectType: "user",
    subjectId: first.userId,
    details: { workingGroupId: groupId },
  };
  expect((await entries()).slice(3)).toEqual([granted]);
  expect(
    (await grantCoordinator(db(), { email: "c@example.test", workingGroupId: groupId }, system))
      .changed,
  ).toBe(false);
  expect(await entries()).toHaveLength(4);
});

test("grantCoordinator raises a volunteer, with one entry", async () => {
  const { orgId, groupId } = await setup();
  const [v] = await db()
    .insert(users)
    .values({ name: "", email: "v@example.test" })
    .returning({ id: users.id });
  await db()
    .insert(workingGroupMemberships)
    .values({ userId: v!.id, workingGroupId: groupId, isCoordinator: false });
  const raised = await grantCoordinator(
    db(),
    { email: "v@example.test", workingGroupId: groupId },
    system,
  );
  expect(raised).toEqual({ userId: v!.id, changed: true, created: false });
  expect(
    await db()
      .select()
      .from(workingGroupMemberships)
      .where(eq(workingGroupMemberships.userId, v!.id)),
  ).toMatchObject([{ isCoordinator: true }]);
  expect((await entries()).slice(3)).toEqual([
    {
      action: "role.coordinator_granted",
      organizationId: orgId,
      subjectType: "user",
      subjectId: v!.id,
      details: { workingGroupId: groupId },
    },
  ]);
});

test("revokeCoordinator leaves a volunteer membership, with one entry, and a repeat adds none", async () => {
  const { orgId, groupId } = await setup();
  const { userId } = await grantCoordinator(
    db(),
    { email: "c@example.test", workingGroupId: groupId },
    system,
  );
  expect(
    (await revokeCoordinator(db(), { email: "c@example.test", workingGroupId: groupId }, system))
      .changed,
  ).toBe(true);
  expect((await getAccess(db(), userId))?.memberships).toMatchObject([{ isCoordinator: false }]);
  expect((await entries()).slice(4)).toEqual([
    {
      action: "role.coordinator_revoked",
      organizationId: orgId,
      subjectType: "user",
      subjectId: userId,
      details: { workingGroupId: groupId },
    },
  ]);
  expect(
    (await revokeCoordinator(db(), { email: "c@example.test", workingGroupId: groupId }, system))
      .changed,
  ).toBe(false);
  expect(await entries()).toHaveLength(5);
});

test("organization admin can be granted and revoked, each with one entry", async () => {
  const { orgId } = await setup();
  const input = { email: "o@example.test", organizationId: orgId };
  const granted = await grantOrganizationAdmin(db(), input, system);
  expect(granted.changed).toBe(true);
  expect((await getAccess(db(), granted.userId))?.adminOfOrganizationIds).toEqual([orgId]);
  expect((await entries()).slice(3)).toEqual([
    {
      action: "role.organization_admin_granted",
      organizationId: orgId,
      subjectType: "user",
      subjectId: granted.userId,
      details: {},
    },
  ]);
  expect((await grantOrganizationAdmin(db(), input, system)).changed).toBe(false);
  expect(await entries()).toHaveLength(4);

  expect((await revokeOrganizationAdmin(db(), input, system)).changed).toBe(true);
  expect((await getAccess(db(), granted.userId))?.adminOfOrganizationIds).toEqual([]);
  expect((await entries()).slice(4)).toEqual([
    {
      action: "role.organization_admin_revoked",
      organizationId: orgId,
      subjectType: "user",
      subjectId: granted.userId,
      details: {},
    },
  ]);
  expect((await revokeOrganizationAdmin(db(), input, system)).changed).toBe(false);
  expect(await entries()).toHaveLength(5);
});

test("an unknown organization or working group is reported by code", async () => {
  const missing = "01900000-0000-7000-8000-000000000000";
  await expect(
    createWorkingGroup(db(), { organizationId: missing, name: "X", city: "Y" }, system),
  ).rejects.toMatchObject({ code: "organization_not_found" });
  await expect(
    grantOrganizationAdmin(db(), { email: "o@example.test", organizationId: missing }, system),
  ).rejects.toMatchObject({ code: "organization_not_found" });
  await expect(
    grantCoordinator(db(), { email: "o@example.test", workingGroupId: missing }, system),
  ).rejects.toMatchObject({ code: "working_group_not_found" });
  expect(await db().select().from(users)).toHaveLength(0);
});

test("revokes for an unknown target are reported by code", async () => {
  const { orgId, groupId } = await setup();
  const missing = "01900000-0000-7000-8000-000000000000";
  const before = await entries();
  await expect(
    revokeCoordinator(db(), { email: "c@example.test", workingGroupId: missing }, system),
  ).rejects.toMatchObject({ code: "working_group_not_found" });
  await expect(
    revokeCoordinator(db(), { email: "niemand@example.test", workingGroupId: groupId }, system),
  ).rejects.toMatchObject({ code: "user_not_found" });
  await expect(
    revokeOrganizationAdmin(db(), { email: "o@example.test", organizationId: missing }, system),
  ).rejects.toMatchObject({ code: "organization_not_found" });
  await expect(
    revokeOrganizationAdmin(db(), { email: "niemand@example.test", organizationId: orgId }, system),
  ).rejects.toMatchObject({ code: "user_not_found" });
  expect(await entries()).toEqual(before);
});

test("the audit entry of a coordinator grant names the organization and the group, and no person by name", async () => {
  const { orgId, groupId } = await setup();
  const { userId } = await grantCoordinator(
    db(),
    { email: "c@example.test", workingGroupId: groupId },
    system,
  );
  const [entry] = await db()
    .select()
    .from(auditLogEntries)
    .where(eq(auditLogEntries.action, "role.coordinator_granted"));
  expect(entry).toMatchObject({
    organizationId: orgId,
    subjectType: "user",
    subjectId: userId,
    details: { workingGroupId: groupId },
  });
  expect(JSON.stringify(entry)).not.toContain("example.test");
});

test("an invalid address is rejected before any write", async () => {
  for (const email of ["", "nobody", "a@", `${"a".repeat(250)}@example.test`]) {
    await expect(grantPlatformAdmin(db(), { email }, system)).rejects.toMatchObject({
      code: "invalid_email",
    });
  }
  expect(await db().select().from(users)).toEqual([]);
});

test("a grant reports whether it created the account", async () => {
  const first = await grantPlatformAdmin(db(), { email: "n@example.test" }, system);
  const second = await grantPlatformAdmin(db(), { email: "n@example.test" }, system);
  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
});

/**
 * Listens on the live events channel on a connection of its own. `drain()` sends a marker in a
 * transaction of its own and returns everything that arrived before it: PostgreSQL delivers
 * notifications in commit order, so whatever an earlier transaction sent has arrived by then.
 */
async function listenForLiveEvents() {
  const listener = new pg.Client({ connectionString: t!.url });
  await listener.connect();
  const received: LiveEvent[] = [];
  let arrived: (() => void) | undefined;
  listener.on("notification", (message) => {
    received.push(liveEventsChannel.schema.parse(JSON.parse(message.payload ?? "")));
    arrived?.();
  });
  await listener.query(`LISTEN ${liveEventsChannel.name}`);
  let markers = 0;
  return {
    async drain(): Promise<LiveEvent[]> {
      const beatAt = new Date(Date.UTC(2027, 2, 1, 19, 30, markers++)).toISOString();
      await db().transaction((tx) =>
        notify(tx, liveEventsChannel, { type: "worker-heartbeat", beatAt }),
      );
      const isMarker = (e: LiveEvent) => e.type === "worker-heartbeat" && e.beatAt === beatAt;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The marker did not arrive")), 5_000);
        const check = () => {
          if (!received.some(isMarker)) return;
          clearTimeout(timer);
          resolve();
        };
        arrived = check;
        check();
      });
      const index = received.findIndex(isMarker);
      return received.splice(0, index + 1).slice(0, index);
    },
    close: () => listener.end(),
  };
}

test("every grant and revoke that changes something sends access-changed for that user", async () => {
  const { orgId, groupId } = await setup();
  const events = await listenForLiveEvents();
  try {
    const changed = (userId: string) => [{ type: "access-changed", userId }];

    const platform = await grantPlatformAdmin(db(), { email: "p@example.test" }, system);
    expect(await events.drain()).toEqual(changed(platform.userId));
    await grantPlatformAdmin(db(), { email: "q@example.test" }, system);
    await logIn("q@example.test");
    await events.drain();
    expect((await revokePlatformAdmin(db(), { email: "p@example.test" }, system)).userId).toBe(
      platform.userId,
    );
    expect(await events.drain()).toEqual(changed(platform.userId));

    const orgInput = { email: "o@example.test", organizationId: orgId };
    const orgAdmin = await grantOrganizationAdmin(db(), orgInput, system);
    expect(await events.drain()).toEqual(changed(orgAdmin.userId));
    await revokeOrganizationAdmin(db(), orgInput, system);
    expect(await events.drain()).toEqual(changed(orgAdmin.userId));

    const groupInput = { email: "c@example.test", workingGroupId: groupId };
    const coordinator = await grantCoordinator(db(), groupInput, system);
    expect(await events.drain()).toEqual(changed(coordinator.userId));
    await revokeCoordinator(db(), groupInput, system);
    expect(await events.drain()).toEqual(changed(coordinator.userId));
  } finally {
    await events.close();
  }
});

test("a grant or revoke that changes nothing, or fails, sends no event", async () => {
  const { orgId, groupId } = await setup();
  await grantPlatformAdmin(db(), { email: "p@example.test" }, system);
  await grantOrganizationAdmin(db(), { email: "o@example.test", organizationId: orgId }, system);
  await grantCoordinator(db(), { email: "c@example.test", workingGroupId: groupId }, system);
  const events = await listenForLiveEvents();
  try {
    expect((await grantPlatformAdmin(db(), { email: "p@example.test" }, system)).changed).toBe(
      false,
    );
    await expect(
      revokePlatformAdmin(db(), { email: "p@example.test" }, system),
    ).rejects.toMatchObject({ code: "last_platform_admin" });
    expect((await revokePlatformAdmin(db(), { email: "o@example.test" }, system)).changed).toBe(
      false,
    );
    const orgInput = { email: "o@example.test", organizationId: orgId };
    expect((await grantOrganizationAdmin(db(), orgInput, system)).changed).toBe(false);
    expect(
      (await revokeOrganizationAdmin(db(), { ...orgInput, email: "c@example.test" }, system))
        .changed,
    ).toBe(false);
    const groupInput = { email: "c@example.test", workingGroupId: groupId };
    expect((await grantCoordinator(db(), groupInput, system)).changed).toBe(false);
    expect(
      (await revokeCoordinator(db(), { ...groupInput, email: "o@example.test" }, system)).changed,
    ).toBe(false);
    expect(await events.drain()).toEqual([]);
  } finally {
    await events.close();
  }
});

test("normalizeName trims and turns every run of whitespace into one space", () => {
  expect(normalizeName("  Paddentrek \t Voorbeeldstad\n")).toBe("Paddentrek Voorbeeldstad");
});

async function adminRows(organizationId: string) {
  return db()
    .select({ userId: organizationAdmins.userId })
    .from(organizationAdmins)
    .where(eq(organizationAdmins.organizationId, organizationId));
}

async function newOrganization(name = "Paddentrek Voorbeeldstad", adminEmail = "a@example.test") {
  return createOrganization(db(), { name, adminEmail }, system);
}

test("creating an organization makes its admin in the same transaction", async () => {
  const result = await createOrganization(
    db(),
    { name: " Paddentrek  Voorbeeldstad ", adminEmail: " Bram@Example.test " },
    system,
  );
  expect(result.adminCreated).toBe(true);
  expect(await db().select().from(organizations)).toMatchObject([
    { id: result.id, name: "Paddentrek Voorbeeldstad", contactEmail: null },
  ]);
  expect(await db().select().from(users)).toMatchObject([
    { id: result.adminUserId, email: "bram@example.test" },
  ]);
  expect(await adminRows(result.id)).toEqual([{ userId: result.adminUserId }]);
  expect(await entries()).toEqual([
    {
      action: "organization.created",
      organizationId: result.id,
      subjectType: "organization",
      subjectId: result.id,
      details: {},
    },
    {
      action: "role.organization_admin_granted",
      organizationId: result.id,
      subjectType: "user",
      subjectId: result.adminUserId,
      details: {},
    },
  ]);
});

test("creating an organization with an existing account makes no new account", async () => {
  const [existing] = await db()
    .insert(users)
    .values({ name: "Bram", email: "bram@example.test", emailVerified: true })
    .returning({ id: users.id });
  const result = await createOrganization(
    db(),
    { name: "Org", adminEmail: "BRAM@example.test", contactEmail: " Info@Example.test " },
    system,
  );
  expect(result).toEqual({ id: result.id, adminUserId: existing!.id, adminCreated: false });
  expect(await db().select().from(users)).toHaveLength(1);
  const [org] = await db().select().from(organizations);
  expect(org?.contactEmail).toBe("info@example.test");
});

test("creating an organization sends access-changed to its admin", async () => {
  const events = await listenForLiveEvents();
  try {
    const result = await newOrganization();
    expect(await events.drain()).toEqual([{ type: "access-changed", userId: result.adminUserId }]);
  } finally {
    await events.close();
  }
});

test.each([
  ["jan@", "invalid_email"],
  ["deleted-0192f3c0-0000-7000-8000-000000000001@deleted.invalid", "user_not_found"],
])("an organization is not created with the admin address %j (%s)", async (adminEmail, code) => {
  await db().insert(users).values({
    name: "Verwijderd account",
    email: "deleted-0192f3c0-0000-7000-8000-000000000001@deleted.invalid",
    deletedAt: new Date(),
  });
  const attempt = createOrganization(db(), { name: "Org", adminEmail }, system);
  await expect(attempt).rejects.toBeInstanceOf(AdminError);
  await expect(attempt).rejects.toMatchObject({ code });
  expect(await db().select().from(organizations)).toEqual([]);
  expect(await db().select().from(organizationAdmins)).toEqual([]);
  expect(await entries()).toEqual([]);
});

test("an organization is not created with an invalid contact address", async () => {
  await expect(
    createOrganization(
      db(),
      { name: "Org", adminEmail: "a@example.test", contactEmail: "info@" },
      system,
    ),
  ).rejects.toMatchObject({ code: "invalid_email" });
  expect(await db().select().from(organizations)).toEqual([]);
  expect(await db().select().from(users)).toEqual([]);
});

test.each(["Paddentrek Voorbeeldstad", "paddentrek  voorbeeldstad "])(
  "the name %j is taken",
  async (name) => {
    await newOrganization("Paddentrek Voorbeeldstad", "a@example.test");
    const before = await entries();
    await expect(
      createOrganization(db(), { name, adminEmail: "b@example.test" }, system),
    ).rejects.toMatchObject({ code: "name_taken" });
    expect(await db().select().from(organizations)).toHaveLength(1);
    expect(await db().select().from(users)).toHaveLength(1);
    expect(await entries()).toEqual(before);
  },
);

test("two creates of the same name at the same moment give one organization and one admin row", async () => {
  const results = await Promise.allSettled([
    createOrganization(
      db(),
      { name: "Paddentrek Voorbeeldstad", adminEmail: "a@example.test" },
      system,
    ),
    createOrganization(
      db(),
      { name: "paddentrek voorbeeldstad", adminEmail: "b@example.test" },
      system,
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.filter((r) => r.status === "rejected");
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "name_taken" });
  expect(await db().select().from(organizations)).toHaveLength(1);
  expect(await db().select().from(organizationAdmins)).toHaveLength(1);
  expect(await db().select().from(users)).toHaveLength(1);
});

test("lockOrganization is false for an organization that does not exist", async () => {
  const { id } = await newOrganization();
  await db().transaction(async (tx) => {
    expect(await lockOrganization(tx, id)).toBe(true);
    expect(await lockOrganization(tx, "01900000-0000-7000-8000-000000000000")).toBe(false);
  });
});

test("the last admin cannot be removed; with a second one it works", async () => {
  const { id: organizationId, adminUserId: a } = await newOrganization();
  const before = await entries();
  await expect(
    removeOrganizationAdmin(db(), { organizationId, userId: a }, system),
  ).rejects.toMatchObject({ code: "last_organization_admin" });
  const attempt = revokeOrganizationAdmin(
    db(),
    { email: "a@example.test", organizationId },
    system,
  );
  await expect(attempt).rejects.toBeInstanceOf(AdminError);
  await expect(attempt).rejects.toMatchObject({ code: "last_organization_admin" });
  expect(await adminRows(organizationId)).toEqual([{ userId: a }]);
  expect(await entries()).toEqual(before);

  const b = await grantOrganizationAdmin(db(), { email: "b@example.test", organizationId }, system);
  expect(await removeOrganizationAdmin(db(), { organizationId, userId: a }, system)).toEqual({
    changed: true,
  });
  expect(await adminRows(organizationId)).toEqual([{ userId: b.userId }]);
  expect((await entries()).at(-1)).toEqual({
    action: "role.organization_admin_revoked",
    organizationId,
    subjectType: "user",
    subjectId: a,
    details: {},
  });
  await expect(
    revokeOrganizationAdmin(db(), { email: "b@example.test", organizationId }, system),
  ).rejects.toMatchObject({ code: "last_organization_admin" });
});

test("removing someone who is no admin there changes nothing", async () => {
  const { id: organizationId } = await newOrganization();
  const other = await newOrganization("Andere", "b@example.test");
  const before = await entries();
  expect(
    await removeOrganizationAdmin(db(), { organizationId, userId: other.adminUserId }, system),
  ).toEqual({ changed: false });
  expect(await entries()).toEqual(before);
});

test("removing an admin of an organization that does not exist is organization_not_found", async () => {
  const { adminUserId } = await newOrganization();
  await expect(
    removeOrganizationAdmin(
      db(),
      { organizationId: "01900000-0000-7000-8000-000000000000", userId: adminUserId },
      system,
    ),
  ).rejects.toMatchObject({ code: "organization_not_found" });
});

test("removing an admin sends access-changed to them", async () => {
  const { id: organizationId, adminUserId } = await newOrganization();
  await grantOrganizationAdmin(db(), { email: "b@example.test", organizationId }, system);
  const events = await listenForLiveEvents();
  try {
    await removeOrganizationAdmin(db(), { organizationId, userId: adminUserId }, system);
    expect(await events.drain()).toEqual([{ type: "access-changed", userId: adminUserId }]);
  } finally {
    await events.close();
  }
});

test("two admins removing each other at the same moment leave one", async () => {
  const { id: organizationId, adminUserId: a } = await newOrganization();
  const { userId: b } = await grantOrganizationAdmin(
    db(),
    { email: "b@example.test", organizationId },
    system,
  );
  const results = await Promise.allSettled([
    removeOrganizationAdmin(db(), { organizationId, userId: a }, system),
    removeOrganizationAdmin(db(), { organizationId, userId: b }, system),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect((fulfilled[0] as PromiseFulfilledResult<{ changed: boolean }>).value).toEqual({
    changed: true,
  });
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
    code: "last_organization_admin",
  });
  expect(await adminRows(organizationId)).toHaveLength(1);
});

test("a removal by ID and a revoke by address at the same moment leave one", async () => {
  const { id: organizationId, adminUserId: a } = await newOrganization();
  await grantOrganizationAdmin(db(), { email: "b@example.test", organizationId }, system);
  const results = await Promise.allSettled([
    removeOrganizationAdmin(db(), { organizationId, userId: a }, system),
    revokeOrganizationAdmin(db(), { email: "b@example.test", organizationId }, system),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await adminRows(organizationId)).toHaveLength(1);
});

test("an admin who never logged in counts as an admin", async () => {
  // The first admin's account was made by createOrganization and never logged in.
  const { id: organizationId, adminUserId: never } = await newOrganization();
  const [row] = await db().select().from(users).where(eq(users.id, never));
  expect(row?.lastLoginAt).toBeNull();
  const b = await grantOrganizationAdmin(db(), { email: "b@example.test", organizationId }, system);
  await db()
    .update(users)
    .set({ emailVerified: true, lastLoginAt: new Date() })
    .where(eq(users.id, b.userId));
  expect(await removeOrganizationAdmin(db(), { organizationId, userId: b.userId }, system)).toEqual(
    { changed: true },
  );
  expect(await adminRows(organizationId)).toEqual([{ userId: never }]);
});

test("a rename writes the old and new name; a contact change writes contactChanged and no address", async () => {
  const { id: organizationId } = await newOrganization("Paddentrek Voorbeeldstad");
  expect(
    await updateOrganization(
      db(),
      { organizationId, patch: { name: "  Paddentrek  Voorbeeldstad-Noord " } },
      system,
    ),
  ).toEqual({ changed: true });
  expect(
    await updateOrganization(
      db(),
      { organizationId, patch: { contactEmail: " Info@Example.test " } },
      system,
    ),
  ).toEqual({ changed: true });
  expect(
    await updateOrganization(
      db(),
      { organizationId, patch: { name: "Paddentrek Voorbeeldstad", contactEmail: null } },
      system,
    ),
  ).toEqual({ changed: true });
  const updates = (await entries()).filter((e) => e.action === "organization.updated");
  expect(updates).toEqual([
    {
      action: "organization.updated",
      organizationId,
      subjectType: "organization",
      subjectId: organizationId,
      details: {
        organizationNameFrom: "Paddentrek Voorbeeldstad",
        organizationNameTo: "Paddentrek Voorbeeldstad-Noord",
      },
    },
    {
      action: "organization.updated",
      organizationId,
      subjectType: "organization",
      subjectId: organizationId,
      details: { contactChanged: true },
    },
    {
      action: "organization.updated",
      organizationId,
      subjectType: "organization",
      subjectId: organizationId,
      details: {
        organizationNameFrom: "Paddentrek Voorbeeldstad-Noord",
        organizationNameTo: "Paddentrek Voorbeeldstad",
        contactChanged: true,
      },
    },
  ]);
  for (const entry of updates) expect(JSON.stringify(entry.details)).not.toContain("@");
  const [org] = await db().select().from(organizations);
  expect(org).toMatchObject({ name: "Paddentrek Voorbeeldstad", contactEmail: null });
});

test("a patch that changes nothing writes no entry", async () => {
  const { id: organizationId } = await createOrganization(
    db(),
    {
      name: "Paddentrek Voorbeeldstad",
      adminEmail: "a@example.test",
      contactEmail: "info@example.test",
    },
    system,
  );
  const before = await entries();
  for (const patch of [
    {},
    { name: " Paddentrek  Voorbeeldstad " },
    { contactEmail: "INFO@example.test" },
    { name: "Paddentrek Voorbeeldstad", contactEmail: "info@example.test" },
  ]) {
    expect(await updateOrganization(db(), { organizationId, patch }, system)).toEqual({
      changed: false,
    });
  }
  expect(await entries()).toEqual(before);
});

test("a rename in other capitals is a change; to the name of another organization is name_taken", async () => {
  const { id: organizationId } = await newOrganization("Paddentrek Voorbeeldstad");
  await newOrganization("Paddenwerkgroep Fictiefdorp", "b@example.test");
  expect(
    await updateOrganization(
      db(),
      { organizationId, patch: { name: "Paddentrek voorbeeldstad" } },
      system,
    ),
  ).toEqual({ changed: true });
  const before = await entries();
  await expect(
    updateOrganization(
      db(),
      { organizationId, patch: { name: "paddenwerkgroep  fictiefdorp" } },
      system,
    ),
  ).rejects.toMatchObject({ code: "name_taken" });
  expect(await entries()).toEqual(before);
});

test("updating an organization that does not exist is organization_not_found", async () => {
  await expect(
    updateOrganization(
      db(),
      { organizationId: "01900000-0000-7000-8000-000000000000", patch: { name: "X" } },
      system,
    ),
  ).rejects.toMatchObject({ code: "organization_not_found" });
});

test("listOrganizations says whether an organization has an admin", async () => {
  const { id, adminUserId } = await newOrganization();
  await db().delete(organizationAdmins).where(eq(organizationAdmins.userId, adminUserId));
  expect(await listOrganizations(db())).toMatchObject([{ id, hasAdmin: false }]);
});
