import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  AdminError,
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  listOrganizations,
  normalizeEmail,
  revokeCoordinator,
  revokeOrganizationAdmin,
  revokePlatformAdmin,
} from "./admin";
import { getAccess } from "./access";
import type { AuditActor } from "./audit-log";
import { auditLogEntries, users, workingGroupMemberships } from "./schema";
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
  const org = await createOrganization(db(), { name: "Paddentrek Enschede" }, system);
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
    "working_group.created",
  ]);
  expect(entries.every((e) => e.organizationId === orgId)).toBe(true);
  expect(await listOrganizations(db())).toEqual([
    {
      id: orgId,
      name: "Paddentrek Enschede",
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
  expect(await db().select().from(auditLogEntries)).toHaveLength(2);
});

test("the same name in another organization is fine", async () => {
  await setup();
  const other = await createOrganization(db(), { name: "Andere" }, system);
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
  const results = await Promise.allSettled([
    revokePlatformAdmin(db(), { email: "a@example.test" }, system),
    revokePlatformAdmin(db(), { email: "b@example.test" }, system),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await db().select().from(users).where(eq(users.isPlatformAdmin, true))).toHaveLength(1);
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
  expect((await getAccess(db(), first.userId))?.memberships[0]?.role).toBe("coordinator");
  const granted = {
    action: "role.coordinator_granted",
    organizationId: orgId,
    subjectType: "user",
    subjectId: first.userId,
    details: { workingGroupId: groupId },
  };
  expect((await entries()).slice(2)).toEqual([granted]);
  expect(
    (await grantCoordinator(db(), { email: "c@example.test", workingGroupId: groupId }, system))
      .changed,
  ).toBe(false);
  expect(await entries()).toHaveLength(3);
});

test("grantCoordinator raises a volunteer, with one entry", async () => {
  const { orgId, groupId } = await setup();
  const [v] = await db()
    .insert(users)
    .values({ name: "", email: "v@example.test" })
    .returning({ id: users.id });
  await db()
    .insert(workingGroupMemberships)
    .values({ userId: v!.id, workingGroupId: groupId, role: "volunteer" });
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
  ).toMatchObject([{ role: "coordinator" }]);
  expect((await entries()).slice(2)).toEqual([
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
  expect((await getAccess(db(), userId))?.memberships).toMatchObject([{ role: "volunteer" }]);
  expect((await entries()).slice(3)).toEqual([
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
  expect(await entries()).toHaveLength(4);
});

test("organization admin can be granted and revoked, each with one entry", async () => {
  const { orgId } = await setup();
  const input = { email: "o@example.test", organizationId: orgId };
  const granted = await grantOrganizationAdmin(db(), input, system);
  expect(granted.changed).toBe(true);
  expect((await getAccess(db(), granted.userId))?.adminOfOrganizationIds).toEqual([orgId]);
  expect((await entries()).slice(2)).toEqual([
    {
      action: "role.organization_admin_granted",
      organizationId: orgId,
      subjectType: "user",
      subjectId: granted.userId,
      details: {},
    },
  ]);
  expect((await grantOrganizationAdmin(db(), input, system)).changed).toBe(false);
  expect(await entries()).toHaveLength(3);

  expect((await revokeOrganizationAdmin(db(), input, system)).changed).toBe(true);
  expect((await getAccess(db(), granted.userId))?.adminOfOrganizationIds).toEqual([]);
  expect((await entries()).slice(3)).toEqual([
    {
      action: "role.organization_admin_revoked",
      organizationId: orgId,
      subjectType: "user",
      subjectId: granted.userId,
      details: {},
    },
  ]);
  expect((await revokeOrganizationAdmin(db(), input, system)).changed).toBe(false);
  expect(await entries()).toHaveLength(4);
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
