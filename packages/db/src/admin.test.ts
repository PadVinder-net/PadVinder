import type { LiveEvent } from "@padvinder/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
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
  lockWorkingGroup,
  normalizeEmail,
  normalizeName,
  removeOrganizationAdmin,
  revokeCoordinator,
  revokeOrganizationAdmin,
  revokePlatformAdmin,
  setCoordinator,
  updateOrganization,
  updateWorkingGroup,
} from "./admin";
import { getAccess } from "./access";
import { liveEventsChannel, notify } from "./notifications";
import type { AuditActor } from "./audit-log";
import type { DbTransaction } from "./client";
import type { MailJob, QueueMail } from "./mail-jobs";
import {
  auditLogEntries,
  organizationAdmins,
  organizations,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";
import { createTestDatabase, holdLock, waitUntilBlocked, type TestDatabase } from "./testing";

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
    {
      organizationId: org.id,
      name: "Noord",
      city: "Enschede",
      coordinatorEmail: "eerste@example.test",
    },
    system,
  );
  return { orgId: org.id, groupId: group.id, firstCoordinatorId: group.coordinatorUserId };
}

test("normalizeEmail trims and lowercases", () => {
  expect(normalizeEmail("  A@Example.TEST ")).toBe("a@example.test");
});

test("creates an organization and a working group, each with an audit entry", async () => {
  const { orgId, groupId } = await setup();
  const entries = await db().select().from(auditLogEntries);
  expect(entries.map((e) => e.action).sort()).toEqual([
    "organization.created",
    "role.coordinator_granted",
    "role.organization_admin_granted",
    "working_group.created",
  ]);
  expect(entries.every((e) => e.organizationId === orgId)).toBe(true);
  expect(await listOrganizations(db())).toEqual([
    {
      id: orgId,
      name: "Paddentrek Enschede",
      hasAdmin: true,
      workingGroups: [
        { id: groupId, name: "Noord", city: "Enschede", active: true, hasCoordinator: true },
      ],
    },
  ]);
});

test.each(["Noord", "noord", " NOORD  "])(
  "a second working group named %j in one organization is name_taken",
  async (name) => {
    const { orgId } = await setup();
    await expect(
      createWorkingGroup(
        db(),
        { organizationId: orgId, name, city: "Hengelo", coordinatorEmail: "b@example.test" },
        system,
      ),
    ).rejects.toMatchObject({ code: "name_taken" });
    expect(await db().select().from(auditLogEntries)).toHaveLength(4);
    expect(await db().select().from(workingGroups)).toHaveLength(1);
    expect(await db().select().from(users).where(eq(users.email, "b@example.test"))).toEqual([]);
  },
);

test("the same name in another organization is fine", async () => {
  await setup();
  const other = await createOrganization(
    db(),
    { name: "Andere", adminEmail: "andere@example.test" },
    system,
  );
  await expect(
    createWorkingGroup(
      db(),
      {
        organizationId: other.id,
        name: "Noord",
        city: "Hengelo",
        coordinatorEmail: "b@example.test",
      },
      system,
    ),
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
  // Only the first coordinator's membership.
  expect(await db().select().from(workingGroupMemberships)).toHaveLength(1);
  expect(await db().select().from(users).where(eq(users.email, "c@example.test"))).toEqual([]);
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
  expect((await entries()).slice(4)).toEqual([granted]);
  expect(
    (await grantCoordinator(db(), { email: "c@example.test", workingGroupId: groupId }, system))
      .changed,
  ).toBe(false);
  expect(await entries()).toHaveLength(5);
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
  expect((await entries()).slice(4)).toEqual([
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
  expect((await entries()).slice(5)).toEqual([
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
  expect(await entries()).toHaveLength(6);
});

test("organization admin can be granted and revoked, each with one entry", async () => {
  const { orgId } = await setup();
  const input = { email: "o@example.test", organizationId: orgId };
  const granted = await grantOrganizationAdmin(db(), input, system);
  expect(granted.changed).toBe(true);
  expect((await getAccess(db(), granted.userId))?.adminOfOrganizationIds).toEqual([orgId]);
  expect((await entries()).slice(4)).toEqual([
    {
      action: "role.organization_admin_granted",
      organizationId: orgId,
      subjectType: "user",
      subjectId: granted.userId,
      details: {},
    },
  ]);
  expect((await grantOrganizationAdmin(db(), input, system)).changed).toBe(false);
  expect(await entries()).toHaveLength(5);

  expect((await revokeOrganizationAdmin(db(), input, system)).changed).toBe(true);
  expect((await getAccess(db(), granted.userId))?.adminOfOrganizationIds).toEqual([]);
  expect((await entries()).slice(5)).toEqual([
    {
      action: "role.organization_admin_revoked",
      organizationId: orgId,
      subjectType: "user",
      subjectId: granted.userId,
      details: {},
    },
  ]);
  expect((await revokeOrganizationAdmin(db(), input, system)).changed).toBe(false);
  expect(await entries()).toHaveLength(6);
});

test("an unknown organization or working group is reported by code", async () => {
  const missing = "01900000-0000-7000-8000-000000000000";
  await expect(
    createWorkingGroup(
      db(),
      { organizationId: missing, name: "X", city: "Y", coordinatorEmail: "c@example.test" },
      system,
    ),
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
    .where(
      and(
        eq(auditLogEntries.action, "role.coordinator_granted"),
        eq(auditLogEntries.subjectId, userId),
      ),
    );
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

/**
 * Runs two changes so that they overlap every time: a share lock on the rows they delete or
 * update lets both read and count first, then holds both at their write (or, with the lock under
 * test, one at its write and the other at the lock) until both wait.
 */
async function atTheSameMoment<A, B>(
  rows: (tx: DbTransaction) => Promise<unknown>,
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  const held = await holdLock(db(), rows);
  const changes = Promise.allSettled([first(), second()]);
  await waitUntilBlocked(db(), 2);
  await held.release();
  return changes;
}

const shareAdminRows = (organizationId: string) => (tx: DbTransaction) =>
  tx.execute(
    sql`select user_id from organization_admins where organization_id = ${organizationId} for share`,
  );

const shareMemberships = (workingGroupId: string) => (tx: DbTransaction) =>
  tx.execute(
    sql`select id from working_group_memberships where working_group_id = ${workingGroupId} for share`,
  );

test("two admins removing each other at the same moment leave one", async () => {
  const { id: organizationId, adminUserId: a } = await newOrganization();
  const { userId: b } = await grantOrganizationAdmin(
    db(),
    { email: "b@example.test", organizationId },
    system,
  );
  const results = await atTheSameMoment(
    shareAdminRows(organizationId),
    () => removeOrganizationAdmin(db(), { organizationId, userId: a }, system),
    () => removeOrganizationAdmin(db(), { organizationId, userId: b }, system),
  );
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
  const results = await atTheSameMoment(
    shareAdminRows(organizationId),
    () => removeOrganizationAdmin(db(), { organizationId, userId: a }, system),
    () => revokeOrganizationAdmin(db(), { email: "b@example.test", organizationId }, system),
  );
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

// --- An active working group always has a coordinator ---

const asUser = (userId: string): AuditActor => ({ kind: "user", userId });

/** An account that has logged in, as the login flow leaves it. */
async function loggedInUser(email: string): Promise<string> {
  const [row] = await db()
    .insert(users)
    .values({ name: "Iemand", email, emailVerified: true, lastLoginAt: new Date() })
    .returning({ id: users.id });
  return row!.id;
}

async function addMembership(userId: string, workingGroupId: string, isCoordinator = false) {
  const [row] = await db()
    .insert(workingGroupMemberships)
    .values({ userId, workingGroupId, isCoordinator })
    .returning({ id: workingGroupMemberships.id });
  return row!.id;
}

async function membershipsOf(workingGroupId: string) {
  return db()
    .select({
      id: workingGroupMemberships.id,
      userId: workingGroupMemberships.userId,
      isCoordinator: workingGroupMemberships.isCoordinator,
    })
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, workingGroupId));
}

async function membershipIdOf(userId: string, workingGroupId: string) {
  const row = (await membershipsOf(workingGroupId)).find((m) => m.userId === userId);
  return row!.id;
}

async function coordinatorCount(workingGroupId: string) {
  return (await membershipsOf(workingGroupId)).filter((m) => m.isCoordinator).length;
}

async function groupsOf(organizationId: string) {
  return db().select().from(workingGroups).where(eq(workingGroups.organizationId, organizationId));
}

test("creating a working group makes its coordinator in the same transaction", async () => {
  const org = await newOrganization();
  const before = await entries();
  const events = await listenForLiveEvents();
  try {
    const result = await createWorkingGroup(
      db(),
      {
        organizationId: org.id,
        name: "  Noord  West ",
        city: " Voorbeeldstad ",
        coordinatorEmail: " Carla@Example.test ",
      },
      system,
    );
    expect(result).toEqual({
      id: expect.any(String),
      coordinatorUserId: expect.any(String),
      coordinatorCreated: true,
    });
    expect(await groupsOf(org.id)).toMatchObject([
      { id: result.id, name: "Noord West", city: "Voorbeeldstad", active: true },
    ]);
    const [carla] = await db().select().from(users).where(eq(users.id, result.coordinatorUserId));
    expect(carla).toMatchObject({ email: "carla@example.test", lastLoginAt: null });
    expect(await membershipsOf(result.id)).toEqual([
      { id: expect.any(String), userId: result.coordinatorUserId, isCoordinator: true },
    ]);
    expect((await entries()).slice(before.length)).toEqual([
      {
        action: "working_group.created",
        organizationId: org.id,
        subjectType: "working_group",
        subjectId: result.id,
        details: {},
      },
      {
        action: "role.coordinator_granted",
        organizationId: org.id,
        subjectType: "user",
        subjectId: result.coordinatorUserId,
        details: { workingGroupId: result.id },
      },
    ]);
    expect(await events.drain()).toEqual([
      { type: "access-changed", userId: result.coordinatorUserId },
    ]);
  } finally {
    await events.close();
  }
});

test("a user may name themself, a new address, a never-used account, a member or admin of the organization", async () => {
  const org = await newOrganization("Paddentrek Voorbeeldstad", "beheer@example.test");
  const other = await newOrganization("Paddenwerkgroep Fictiefdorp", "fictief@example.test");
  const actor = org.adminUserId;
  await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, actor));
  const first = await createWorkingGroup(
    db(),
    {
      organizationId: org.id,
      name: "Noord",
      city: "Voorbeeldstad",
      coordinatorEmail: "beheer@example.test",
    },
    asUser(actor),
  );
  expect(first).toMatchObject({ coordinatorUserId: actor, coordinatorCreated: false });

  const elsewhere = await createWorkingGroup(
    db(),
    {
      organizationId: other.id,
      name: "Dorp",
      city: "Fictiefdorp",
      coordinatorEmail: "dorp@example.test",
    },
    system,
  );
  // An account the tool made elsewhere, that never logged in.
  const never = elsewhere.coordinatorUserId;
  const member = await loggedInUser("lid@example.test");
  await addMembership(member, first.id);
  const secondAdmin = await loggedInUser("tweede-beheer@example.test");
  await grantOrganizationAdmin(
    db(),
    { email: "tweede-beheer@example.test", organizationId: org.id },
    system,
  );

  const cases = [
    ["Nieuw", "nieuw@example.test", true],
    ["Nooit", "dorp@example.test", false],
    ["Lid", "LID@example.test", false],
    ["Beheer", "tweede-beheer@example.test", false],
  ] as const;
  for (const [name, coordinatorEmail, created] of cases) {
    const result = await createWorkingGroup(
      db(),
      { organizationId: org.id, name, city: "Voorbeeldstad", coordinatorEmail },
      asUser(actor),
    );
    expect(result.coordinatorCreated).toBe(created);
    expect(await membershipsOf(result.id)).toMatchObject([
      { userId: result.coordinatorUserId, isCoordinator: true },
    ]);
  }
  const coordinators = await db()
    .select({ userId: workingGroupMemberships.userId })
    .from(workingGroupMemberships)
    .innerJoin(workingGroups, eq(workingGroups.id, workingGroupMemberships.workingGroupId))
    .where(eq(workingGroups.organizationId, org.id));
  expect(coordinators.map((c) => c.userId)).toEqual(
    expect.arrayContaining([actor, never, member, secondAdmin]),
  );
});

test("a user may not name someone with a profile outside the organization", async () => {
  const org = await newOrganization("Paddentrek Voorbeeldstad", "beheer@example.test");
  const other = await newOrganization("Paddenwerkgroep Fictiefdorp", "fictief@example.test");
  const dorp = await createWorkingGroup(
    db(),
    {
      organizationId: other.id,
      name: "Dorp",
      city: "Fictiefdorp",
      coordinatorEmail: "fictief@example.test",
    },
    system,
  );
  // "buiten@example.test" logged in and is a member of a group of another organization.
  const buiten = await loggedInUser("buiten@example.test");
  await addMembership(buiten, dorp.id);
  // A logged-in admin of the other organization, without any membership, is outside too.
  await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, other.adminUserId));
  const before = await entries();
  for (const coordinatorEmail of [" Buiten@Example.test ", "fictief@example.test"]) {
    const attempt = createWorkingGroup(
      db(),
      { organizationId: org.id, name: "Noord", city: "Voorbeeldstad", coordinatorEmail },
      asUser(org.adminUserId),
    );
    await expect(attempt).rejects.toBeInstanceOf(AdminError);
    await expect(attempt).rejects.toMatchObject({ code: "person_outside_organization" });
  }
  expect(await groupsOf(org.id)).toEqual([]);
  expect(
    await db()
      .select()
      .from(workingGroupMemberships)
      .where(eq(workingGroupMemberships.userId, buiten)),
  ).toHaveLength(1);
  expect(await entries()).toEqual(before);
});

test("the system may name anyone", async () => {
  const org = await newOrganization("Paddentrek Voorbeeldstad", "beheer@example.test");
  const buiten = await loggedInUser("buiten@example.test");
  const result = await createWorkingGroup(
    db(),
    {
      organizationId: org.id,
      name: "Noord",
      city: "Voorbeeldstad",
      coordinatorEmail: "buiten@example.test",
    },
    system,
  );
  expect(result).toMatchObject({ coordinatorUserId: buiten, coordinatorCreated: false });
});

test("a working group is not created with an address that is not valid or of a deleted account", async () => {
  const org = await newOrganization();
  await db().insert(users).values({
    name: "Verwijderd account",
    email: "deleted-0192f3c0-0000-7000-8000-000000000001@deleted.invalid",
    deletedAt: new Date(),
  });
  const before = await entries();
  for (const [coordinatorEmail, code] of [
    ["carla@", "invalid_email"],
    ["deleted-0192f3c0-0000-7000-8000-000000000001@deleted.invalid", "user_not_found"],
  ] as const) {
    await expect(
      createWorkingGroup(
        db(),
        { organizationId: org.id, name: "Noord", city: "Voorbeeldstad", coordinatorEmail },
        system,
      ),
    ).rejects.toMatchObject({ code });
  }
  expect(await groupsOf(org.id)).toEqual([]);
  expect(await entries()).toEqual(before);
});

test("two creates of the same name in one organization at the same moment give one group", async () => {
  const org = await newOrganization();
  const results = await Promise.allSettled([
    createWorkingGroup(
      db(),
      {
        organizationId: org.id,
        name: "Noord",
        city: "Voorbeeldstad",
        coordinatorEmail: "c1@example.test",
      },
      system,
    ),
    createWorkingGroup(
      db(),
      {
        organizationId: org.id,
        name: " noord ",
        city: "Voorbeeldstad",
        coordinatorEmail: "c2@example.test",
      },
      system,
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.filter((r) => r.status === "rejected");
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "name_taken" });
  const groups = await groupsOf(org.id);
  expect(groups).toHaveLength(1);
  expect(await membershipsOf(groups[0]!.id)).toHaveLength(1);
  // The organization's admin and one coordinator.
  expect(await db().select().from(users)).toHaveLength(2);
});

test("a name or a city that is empty after normalizing is invalid_name, and nothing is written", async () => {
  const org = await newOrganization();
  const group = await createWorkingGroup(
    db(),
    {
      organizationId: org.id,
      name: "Noord",
      city: "Voorbeeldstad",
      coordinatorEmail: "c@example.test",
    },
    system,
  );
  const before = await entries();
  const invalid = (field: "name" | "city") => ({ code: "invalid_name", field });
  await expect(
    createOrganization(db(), { name: "   ", adminEmail: "x@example.test" }, system),
  ).rejects.toMatchObject(invalid("name"));
  await expect(
    updateOrganization(db(), { organizationId: org.id, patch: { name: " \t " } }, system),
  ).rejects.toMatchObject(invalid("name"));
  await expect(
    createWorkingGroup(
      db(),
      {
        organizationId: org.id,
        name: " ",
        city: "Voorbeeldstad",
        coordinatorEmail: "d@example.test",
      },
      system,
    ),
  ).rejects.toMatchObject(invalid("name"));
  await expect(
    createWorkingGroup(
      db(),
      { organizationId: org.id, name: "Zuid", city: "  ", coordinatorEmail: "d@example.test" },
      system,
    ),
  ).rejects.toMatchObject(invalid("city"));
  await expect(
    updateWorkingGroup(db(), { workingGroupId: group.id, patch: { name: "" } }, system),
  ).rejects.toMatchObject(invalid("name"));
  await expect(
    updateWorkingGroup(db(), { workingGroupId: group.id, patch: { city: "\n" } }, system),
  ).rejects.toMatchObject(invalid("city"));
  expect(await entries()).toEqual(before);
  expect(await db().select().from(organizations)).toHaveLength(1);
  expect((await groupsOf(org.id)).map((g) => [g.name, g.city])).toEqual([
    ["Noord", "Voorbeeldstad"],
  ]);
});

test("lockWorkingGroup gives the organization and the active flag, or null", async () => {
  const { orgId, groupId } = await setup();
  await db().transaction(async (tx) => {
    expect(await lockWorkingGroup(tx, groupId)).toEqual({ organizationId: orgId, active: true });
    expect(await lockWorkingGroup(tx, "01900000-0000-7000-8000-000000000000")).toBeNull();
  });
});

test("the last coordinator of an active group keeps the role; with a second one it can go", async () => {
  const { groupId, firstCoordinatorId } = await setup();
  const first = await membershipIdOf(firstCoordinatorId, groupId);
  const before = await entries();
  const attempt = setCoordinator(db(), { membershipId: first, isCoordinator: false }, system);
  await expect(attempt).rejects.toBeInstanceOf(AdminError);
  await expect(attempt).rejects.toMatchObject({ code: "last_coordinator" });
  await expect(
    revokeCoordinator(db(), { email: "eerste@example.test", workingGroupId: groupId }, system),
  ).rejects.toMatchObject({ code: "last_coordinator" });
  expect(await coordinatorCount(groupId)).toBe(1);
  expect(await entries()).toEqual(before);

  await grantCoordinator(db(), { email: "c@example.test", workingGroupId: groupId }, system);
  expect(await setCoordinator(db(), { membershipId: first, isCoordinator: false }, system)).toEqual(
    { changed: true, userId: firstCoordinatorId, workingGroupId: groupId },
  );
  expect((await entries()).at(-1)).toMatchObject({
    action: "role.coordinator_revoked",
    subjectId: firstCoordinatorId,
    details: { workingGroupId: groupId },
  });
  await expect(
    revokeCoordinator(db(), { email: "c@example.test", workingGroupId: groupId }, system),
  ).rejects.toMatchObject({ code: "last_coordinator" });
  expect(await coordinatorCount(groupId)).toBe(1);
});

test("two coordinators losing the role at the same moment leave one", async () => {
  const { groupId, firstCoordinatorId } = await setup();
  const first = await membershipIdOf(firstCoordinatorId, groupId);
  const second = await grantCoordinator(
    db(),
    { email: "c@example.test", workingGroupId: groupId },
    system,
  );
  const results = await atTheSameMoment(
    shareMemberships(groupId),
    () => setCoordinator(db(), { membershipId: first, isCoordinator: false }, system),
    () => revokeCoordinator(db(), { email: "c@example.test", workingGroupId: groupId }, system),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.filter((r) => r.status === "rejected");
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
    code: "last_coordinator",
  });
  expect(await coordinatorCount(groupId)).toBe(1);

  // Two by ID at the same moment, too.
  const remaining = (await membershipsOf(groupId)).find((m) => m.isCoordinator)!;
  const other = remaining.userId === firstCoordinatorId ? second.userId : firstCoordinatorId;
  await setCoordinator(
    db(),
    { membershipId: await membershipIdOf(other, groupId), isCoordinator: true },
    system,
  );
  const [one, two] = await membershipsOf(groupId);
  const byId = await atTheSameMoment(
    shareMemberships(groupId),
    () => setCoordinator(db(), { membershipId: one!.id, isCoordinator: false }, system),
    () => setCoordinator(db(), { membershipId: two!.id, isCoordinator: false }, system),
  );
  expect(byId.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await coordinatorCount(groupId)).toBe(1);
});

test("the last coordinator of an inactive group can lose the role", async () => {
  const { groupId, firstCoordinatorId } = await setup();
  const first = await membershipIdOf(firstCoordinatorId, groupId);
  await updateWorkingGroup(db(), { workingGroupId: groupId, patch: { active: false } }, system);
  expect(
    await setCoordinator(db(), { membershipId: first, isCoordinator: false }, system),
  ).toMatchObject({ changed: true });
  expect(await coordinatorCount(groupId)).toBe(0);
  await setCoordinator(db(), { membershipId: first, isCoordinator: true }, system);
  expect(
    await revokeCoordinator(
      db(),
      { email: "eerste@example.test", workingGroupId: groupId },
      system,
    ),
  ).toMatchObject({ changed: true });
  expect(await coordinatorCount(groupId)).toBe(0);
});

test("someone can be made coordinator while the group is off", async () => {
  const { orgId, groupId } = await setup();
  const volunteer = await loggedInUser("v@example.test");
  const membershipId = await addMembership(volunteer, groupId);
  await updateWorkingGroup(db(), { workingGroupId: groupId, patch: { active: false } }, system);
  const events = await listenForLiveEvents();
  try {
    expect(await setCoordinator(db(), { membershipId, isCoordinator: true }, system)).toEqual({
      changed: true,
      userId: volunteer,
      workingGroupId: groupId,
    });
    expect(await events.drain()).toEqual([{ type: "access-changed", userId: volunteer }]);
  } finally {
    await events.close();
  }
  expect((await entries()).at(-1)).toEqual({
    action: "role.coordinator_granted",
    organizationId: orgId,
    subjectType: "user",
    subjectId: volunteer,
    details: { workingGroupId: groupId },
  });
});

test("setting the flag to what it is changes nothing and writes no entry", async () => {
  const { groupId, firstCoordinatorId } = await setup();
  const volunteer = await loggedInUser("v@example.test");
  const volunteerMembership = await addMembership(volunteer, groupId);
  const first = await membershipIdOf(firstCoordinatorId, groupId);
  const before = await entries();
  const events = await listenForLiveEvents();
  try {
    expect(
      await setCoordinator(db(), { membershipId: first, isCoordinator: true }, system),
    ).toEqual({ changed: false, userId: firstCoordinatorId, workingGroupId: groupId });
    expect(
      await setCoordinator(
        db(),
        { membershipId: volunteerMembership, isCoordinator: false },
        system,
      ),
    ).toEqual({ changed: false, userId: volunteer, workingGroupId: groupId });
    await expect(
      setCoordinator(
        db(),
        { membershipId: "01900000-0000-7000-8000-000000000000", isCoordinator: true },
        system,
      ),
    ).rejects.toMatchObject({ code: "membership_not_found" });
    expect(await events.drain()).toEqual([]);
  } finally {
    await events.close();
  }
  expect(await entries()).toEqual(before);
});

test("switching off tells every member, writes working_group.deactivated, and takes the group out of getAccess", async () => {
  const { orgId, groupId, firstCoordinatorId } = await setup();
  const volunteer = await loggedInUser("v@example.test");
  await addMembership(volunteer, groupId);
  expect((await getAccess(db(), volunteer))?.memberships).toHaveLength(1);
  const events = await listenForLiveEvents();
  try {
    expect(
      await updateWorkingGroup(db(), { workingGroupId: groupId, patch: { active: false } }, system),
    ).toEqual({ changed: true });
    const received = await events.drain();
    expect(received).toHaveLength(2);
    expect(received).toEqual(
      expect.arrayContaining([
        { type: "access-changed", userId: firstCoordinatorId },
        { type: "access-changed", userId: volunteer },
      ]),
    );
    // Again: nothing changes, nobody is told.
    expect(
      await updateWorkingGroup(db(), { workingGroupId: groupId, patch: { active: false } }, system),
    ).toEqual({ changed: false });
    expect(await events.drain()).toEqual([]);
  } finally {
    await events.close();
  }
  expect((await entries()).filter((e) => e.action.startsWith("working_group."))).toEqual([
    expect.objectContaining({ action: "working_group.created" }),
    {
      action: "working_group.deactivated",
      organizationId: orgId,
      subjectType: "working_group",
      subjectId: groupId,
      details: {},
    },
  ]);
  expect((await getAccess(db(), volunteer))?.memberships).toEqual([]);
  expect((await getAccess(db(), firstCoordinatorId))?.memberships).toEqual([]);
});

test("switching on needs a coordinator", async () => {
  const { orgId, groupId, firstCoordinatorId } = await setup();
  const volunteer = await loggedInUser("v@example.test");
  const volunteerMembership = await addMembership(volunteer, groupId);
  await updateWorkingGroup(db(), { workingGroupId: groupId, patch: { active: false } }, system);
  await setCoordinator(
    db(),
    { membershipId: await membershipIdOf(firstCoordinatorId, groupId), isCoordinator: false },
    system,
  );
  const before = await entries();
  const attempt = updateWorkingGroup(
    db(),
    { workingGroupId: groupId, patch: { active: true, city: "Hengelo" } },
    system,
  );
  await expect(attempt).rejects.toBeInstanceOf(AdminError);
  await expect(attempt).rejects.toMatchObject({ code: "no_coordinator" });
  expect(await groupsOf(orgId)).toMatchObject([{ active: false, city: "Enschede" }]);
  expect(await entries()).toEqual(before);

  await setCoordinator(db(), { membershipId: volunteerMembership, isCoordinator: true }, system);
  const events = await listenForLiveEvents();
  try {
    expect(
      await updateWorkingGroup(db(), { workingGroupId: groupId, patch: { active: true } }, system),
    ).toEqual({ changed: true });
    expect(await events.drain()).toEqual(
      expect.arrayContaining([
        { type: "access-changed", userId: firstCoordinatorId },
        { type: "access-changed", userId: volunteer },
      ]),
    );
  } finally {
    await events.close();
  }
  expect((await entries()).at(-1)).toEqual({
    action: "working_group.activated",
    organizationId: orgId,
    subjectType: "working_group",
    subjectId: groupId,
    details: {},
  });
  expect((await getAccess(db(), volunteer))?.memberships).toHaveLength(1);
});

test("a rename to the name of another group of the organization is name_taken; the same name in another organization is fine", async () => {
  const { orgId, groupId } = await setup();
  const other = await newOrganization("Andere", "andere@example.test");
  await createWorkingGroup(
    db(),
    { organizationId: orgId, name: "Zuid", city: "Enschede", coordinatorEmail: "z@example.test" },
    system,
  );
  await createWorkingGroup(
    db(),
    { organizationId: other.id, name: "West", city: "Hengelo", coordinatorEmail: "w@example.test" },
    system,
  );
  const before = await entries();
  for (const name of [" Zuid ", "zuid", "ZUID"]) {
    const attempt = updateWorkingGroup(db(), { workingGroupId: groupId, patch: { name } }, system);
    await expect(attempt).rejects.toBeInstanceOf(AdminError);
    await expect(attempt).rejects.toMatchObject({ code: "name_taken" });
  }
  expect(await entries()).toEqual(before);

  // Its own name in other capitals is a change, not a conflict with itself.
  expect(
    await updateWorkingGroup(db(), { workingGroupId: groupId, patch: { name: "NOORD" } }, system),
  ).toEqual({ changed: true });

  expect(
    await updateWorkingGroup(db(), { workingGroupId: groupId, patch: { name: "West" } }, system),
  ).toEqual({ changed: true });
  expect((await entries()).at(-1)).toEqual({
    action: "working_group.updated",
    organizationId: orgId,
    subjectType: "working_group",
    subjectId: groupId,
    details: { workingGroupNameFrom: "NOORD", workingGroupNameTo: "West" },
  });
});

test("a changed city writes cityFrom and cityTo and nothing else", async () => {
  const { orgId, groupId } = await setup();
  const before = await entries();
  for (const patch of [{}, { name: " Noord " }, { city: "Enschede" }, { active: true }]) {
    expect(await updateWorkingGroup(db(), { workingGroupId: groupId, patch }, system)).toEqual({
      changed: false,
    });
  }
  expect(await entries()).toEqual(before);
  expect(
    await updateWorkingGroup(
      db(),
      { workingGroupId: groupId, patch: { name: "Noord", city: "  Hengelo " } },
      system,
    ),
  ).toEqual({ changed: true });
  expect((await entries()).slice(before.length)).toEqual([
    {
      action: "working_group.updated",
      organizationId: orgId,
      subjectType: "working_group",
      subjectId: groupId,
      details: { cityFrom: "Enschede", cityTo: "Hengelo" },
    },
  ]);
  expect(await groupsOf(orgId)).toMatchObject([{ name: "Noord", city: "Hengelo" }]);
});

test("updating a working group that does not exist is working_group_not_found", async () => {
  await expect(
    updateWorkingGroup(
      db(),
      { workingGroupId: "01900000-0000-7000-8000-000000000000", patch: { city: "X" } },
      system,
    ),
  ).rejects.toMatchObject({ code: "working_group_not_found" });
});

test("listOrganizations says whether an active working group has a coordinator", async () => {
  const { groupId, firstCoordinatorId } = await setup();
  await db()
    .delete(workingGroupMemberships)
    .where(eq(workingGroupMemberships.userId, firstCoordinatorId));
  const [organization] = await listOrganizations(db());
  expect(organization?.workingGroups).toMatchObject([{ id: groupId, hasCoordinator: false }]);
});

/** A queue that keeps what was queued. `@padvinder/mail` has one, but it depends on this package. */
function recordingQueue(): { queueMail: QueueMail; jobs: MailJob[] } {
  const jobs: MailJob[] = [];
  return {
    jobs,
    async queueMail(_tx, job) {
      jobs.push(job);
    },
  };
}

test("without a queue nothing is queued", async () => {
  // The tool, the seed and the cast call these without a queue; they must keep working.
  const org = await newOrganization("Org", "beheer@example.test");
  const granted = await grantOrganizationAdmin(
    db(),
    { email: "tweede@example.test", organizationId: org.id },
    asUser(org.adminUserId),
  );
  expect(granted.changed).toBe(true);
  const group = await createWorkingGroup(
    db(),
    { organizationId: org.id, name: "Noord", city: "Enschede", coordinatorEmail: "c@example.test" },
    asUser(org.adminUserId),
  );
  expect(group.coordinatorCreated).toBe(true);
});

test("a new organization queues organization-admin for its first admin", async () => {
  const platformAdmin = await loggedInUser("hoofd@example.test");
  const queue = recordingQueue();
  const org = await createOrganization(
    db(),
    { name: "Org", adminEmail: "beheer@example.test" },
    asUser(platformAdmin),
    { queueMail: queue.queueMail },
  );
  expect(queue.jobs).toEqual([
    { kind: "organization-admin", userId: org.adminUserId, organizationId: org.id },
  ]);

  const granted = await grantOrganizationAdmin(
    db(),
    { email: "tweede@example.test", organizationId: org.id },
    asUser(platformAdmin),
    { queueMail: queue.queueMail },
  );
  expect(queue.jobs.slice(1)).toEqual([
    { kind: "organization-admin", userId: granted.userId, organizationId: org.id },
  ]);
});

test("an admin who names themself gets no mail", async () => {
  const platformAdmin = await loggedInUser("hoofd@example.test");
  const queue = recordingQueue();
  const org = await createOrganization(
    db(),
    { name: "Org", adminEmail: "hoofd@example.test" },
    asUser(platformAdmin),
    { queueMail: queue.queueMail },
  );
  expect(org.adminUserId).toBe(platformAdmin);
  const other = await createOrganization(
    db(),
    { name: "Ander", adminEmail: "a@example.test" },
    system,
  );
  await grantOrganizationAdmin(
    db(),
    { email: "hoofd@example.test", organizationId: other.id },
    asUser(platformAdmin),
    { queueMail: queue.queueMail },
  );
  expect(queue.jobs).toEqual([]);
});

test("appointing someone who is an admin already queues nothing", async () => {
  const platformAdmin = await loggedInUser("hoofd@example.test");
  const org = await newOrganization("Org", "beheer@example.test");
  const queue = recordingQueue();
  const again = await grantOrganizationAdmin(
    db(),
    { email: "beheer@example.test", organizationId: org.id },
    asUser(platformAdmin),
    { queueMail: queue.queueMail },
  );
  expect(again.changed).toBe(false);
  expect(queue.jobs).toEqual([]);
});

test("a new working group queues first-coordinator, unless the creator is the coordinator", async () => {
  const org = await newOrganization("Org", "beheer@example.test");
  const admin = org.adminUserId;
  await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, admin));
  const queue = recordingQueue();
  const group = await createWorkingGroup(
    db(),
    { organizationId: org.id, name: "Noord", city: "Enschede", coordinatorEmail: "c@example.test" },
    asUser(admin),
    { queueMail: queue.queueMail },
  );
  const membershipId = await membershipIdOf(group.coordinatorUserId, group.id);
  expect(queue.jobs).toEqual([{ kind: "first-coordinator", membershipId, byUserId: admin }]);

  await createWorkingGroup(
    db(),
    {
      organizationId: org.id,
      name: "Zuid",
      city: "Enschede",
      coordinatorEmail: "beheer@example.test",
    },
    asUser(admin),
    { queueMail: queue.queueMail },
  );
  expect(queue.jobs).toHaveLength(1);
});

test("the system queues nothing, also when it is handed a queue", async () => {
  const queue = recordingQueue();
  const org = await createOrganization(
    db(),
    { name: "Org", adminEmail: "beheer@example.test" },
    system,
    { queueMail: queue.queueMail },
  );
  await grantOrganizationAdmin(
    db(),
    { email: "tweede@example.test", organizationId: org.id },
    system,
    { queueMail: queue.queueMail },
  );
  await createWorkingGroup(
    db(),
    { organizationId: org.id, name: "Noord", city: "Enschede", coordinatorEmail: "c@example.test" },
    system,
    { queueMail: queue.queueMail },
  );
  expect(queue.jobs).toEqual([]);
});

test("a create that fails queues nothing", async () => {
  const platformAdmin = await loggedInUser("hoofd@example.test");
  const org = await newOrganization("Org", "beheer@example.test");
  await createWorkingGroup(
    db(),
    { organizationId: org.id, name: "Noord", city: "Enschede", coordinatorEmail: "c@example.test" },
    system,
  );
  const queue = recordingQueue();
  await expect(
    createOrganization(
      db(),
      { name: "org", adminEmail: "nieuw@example.test" },
      asUser(platformAdmin),
      { queueMail: queue.queueMail },
    ),
  ).rejects.toMatchObject({ code: "name_taken" });
  await expect(
    createWorkingGroup(
      db(),
      {
        organizationId: org.id,
        name: "noord",
        city: "Enschede",
        coordinatorEmail: "nieuw@example.test",
      },
      asUser(platformAdmin),
      { queueMail: queue.queueMail },
    ),
  ).rejects.toMatchObject({ code: "name_taken" });
  expect(queue.jobs).toEqual([]);
});

test("a queue that fails undoes the change: the job is queued in its transaction", async () => {
  const platformAdmin = await loggedInUser("hoofd@example.test");
  const failing: QueueMail = async () => {
    throw new Error("queue down");
  };
  await expect(
    createOrganization(
      db(),
      { name: "Org", adminEmail: "beheer@example.test" },
      asUser(platformAdmin),
      { queueMail: failing },
    ),
  ).rejects.toThrow("queue down");
  expect(await db().select().from(organizations)).toEqual([]);
  const org = await newOrganization("Org", "beheer@example.test");
  await expect(
    grantOrganizationAdmin(
      db(),
      { email: "tweede@example.test", organizationId: org.id },
      asUser(platformAdmin),
      { queueMail: failing },
    ),
  ).rejects.toThrow("queue down");
  expect(await adminRows(org.id)).toEqual([{ userId: org.adminUserId }]);
  await expect(
    createWorkingGroup(
      db(),
      {
        organizationId: org.id,
        name: "Noord",
        city: "Enschede",
        coordinatorEmail: "c@example.test",
      },
      asUser(platformAdmin),
      { queueMail: failing },
    ),
  ).rejects.toThrow("queue down");
  expect(await groupsOf(org.id)).toEqual([]);
});
