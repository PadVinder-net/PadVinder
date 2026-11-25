import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createOrganization, createWorkingGroup, grantCoordinator } from "./admin";
import { auditLogEntries, users, workingGroupMemberships } from "./schema";
import { getMembership, listMembers, removeMembership } from "./members";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
let groupId = "";
let organizationId = "";
beforeAll(async () => {
  t = await createTestDatabase();
  const system = { kind: "system" } as const;
  organizationId = (await createOrganization(t.db, { name: "Leden Org" }, system)).id;
  groupId = (
    await createWorkingGroup(t.db, { organizationId, name: "Leden", city: "Enschede" }, system)
  ).id;
});
afterAll(async () => {
  await t?.drop();
});

async function addMember(name: string, role: "volunteer" | "coordinator" = "volunteer") {
  const [user] = await t!.db
    .insert(users)
    .values({
      name,
      email: `${randomUUID()}@example.test`,
      phone: name === "Zoë" ? null : "06 11112222",
      emailVerified: true,
    })
    .returning({ id: users.id });
  const [membership] = await t!.db
    .insert(workingGroupMemberships)
    .values({ userId: user!.id, workingGroupId: groupId, isCoordinator: role === "coordinator" })
    .returning({ id: workingGroupMemberships.id });
  return { userId: user!.id, membershipId: membership!.id };
}

test("lists members in Dutch order, without contact keys at all", async () => {
  const eend = await addMember("Éva");
  await addMember("Zoë");
  await addMember("Anna", "coordinator");
  const members = await listMembers(t!.db, groupId, { contact: false });
  expect(members.map((m) => m.name)).toEqual(["Anna", "Éva", "Zoë"]);
  for (const member of members) {
    expect(Object.keys(member).sort()).toEqual(["isCoordinator", "membershipId", "name", "userId"]);
  }
  expect(members[1]).toEqual({
    membershipId: eend.membershipId,
    userId: eend.userId,
    name: "Éva",
    isCoordinator: false,
  });
});

test("with contact, the email address and phone come along", async () => {
  const members = await listMembers(t!.db, groupId, { contact: true });
  const zoe = members.find((m) => m.name === "Zoë")!;
  expect(zoe.email).toMatch(/@example\.test$/);
  expect(zoe.phone).toBeNull();
  expect(members.find((m) => m.name === "Anna")!.phone).toBe("06 11112222");
});

test("with contact, a member carries hasLoggedIn; without, the key is absent", async () => {
  const never = await addMember("Nooit");
  const been = await addMember("Geweest");
  await t!.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, been.userId));
  const withContact = await listMembers(t!.db, groupId, { contact: true });
  expect(withContact.find((m) => m.userId === never.userId)!.hasLoggedIn).toBe(false);
  expect(withContact.find((m) => m.userId === been.userId)!.hasLoggedIn).toBe(true);
  for (const member of await listMembers(t!.db, groupId, { contact: false })) {
    expect(Object.keys(member)).not.toContain("hasLoggedIn");
  }
});

test("a deleted account is never listed, also when a membership was left", async () => {
  const gone = await addMember("Weggegaan");
  await t!.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone.userId));
  for (const contact of [false, true]) {
    const members = await listMembers(t!.db, groupId, { contact });
    expect(members.map((m) => m.userId)).not.toContain(gone.userId);
  }
});

test("getMembership returns the target, or null", async () => {
  const m = await addMember("Get");
  expect(await getMembership(t!.db, m.membershipId)).toEqual({
    membershipId: m.membershipId,
    userId: m.userId,
    isCoordinator: false,
    workingGroupId: groupId,
    organizationId,
  });
  expect(await getMembership(t!.db, randomUUID())).toBeNull();
});

test("removes a membership with one audit entry that holds no personal data", async () => {
  const m = await addMember("Weg");
  const actor = await addMember("Actor", "coordinator");
  expect(
    await removeMembership(t!.db, { membershipId: m.membershipId, removedBy: actor.userId }),
  ).toEqual({ outcome: "removed" });
  expect(await getMembership(t!.db, m.membershipId)).toBeNull();
  const entries = await t!.db
    .select()
    .from(auditLogEntries)
    .where(eq(auditLogEntries.subjectId, m.userId));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    action: "membership.removed",
    actorUserId: actor.userId,
    organizationId,
    subjectType: "user",
    details: { workingGroupId: groupId, role: "volunteer" },
  });
});

test("a membership that is gone is not_found, and two removals at once give one of each", async () => {
  const m = await addMember("Dubbel");
  const input = { membershipId: m.membershipId, removedBy: m.userId };
  const results = await Promise.all([
    removeMembership(t!.db, input),
    removeMembership(t!.db, input),
  ]);
  expect(results.map((r) => r.outcome).sort()).toEqual(["not_found", "removed"]);
  const entries = await t!.db
    .select()
    .from(auditLogEntries)
    .where(eq(auditLogEntries.subjectId, m.userId));
  expect(entries).toHaveLength(1);
});

test("with expectedIsCoordinator, a membership whose flag changed is coordinator_changed and stays", async () => {
  const m = await addMember("Verhoogd");
  await grantCoordinator(
    t!.db,
    {
      email: (await t!.db.select().from(users).where(eq(users.id, m.userId)))[0]!.email,
      workingGroupId: groupId,
    },
    { kind: "system" },
  );
  expect(
    await removeMembership(t!.db, {
      membershipId: m.membershipId,
      removedBy: m.userId,
      expectedIsCoordinator: false,
    }),
  ).toEqual({ outcome: "coordinator_changed" });
  expect(await getMembership(t!.db, m.membershipId)).not.toBeNull();
  expect(
    await removeMembership(t!.db, {
      membershipId: m.membershipId,
      removedBy: m.userId,
      expectedIsCoordinator: true,
    }),
  ).toEqual({ outcome: "removed" });
});
