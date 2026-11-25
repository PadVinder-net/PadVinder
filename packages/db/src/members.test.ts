import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  setCoordinator,
  updateWorkingGroup,
} from "./admin";
import { auditLogEntries, users, workingGroupMemberships } from "./schema";
import { getMember, getMembership, listMembers, removeMembership } from "./members";
import { createTestDatabase, holdLock, waitUntilBlocked, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
let groupId = "";
let organizationId = "";
beforeAll(async () => {
  t = await createTestDatabase();
  const system = { kind: "system" } as const;
  organizationId = (
    await createOrganization(
      t.db,
      { name: "Leden Org", adminEmail: "org-admin@example.test" },
      system,
    )
  ).id;
  groupId = (
    await createWorkingGroup(
      t.db,
      {
        organizationId,
        name: "Leden",
        city: "Enschede",
        coordinatorEmail: "leden-coordinator@example.test",
      },
      system,
    )
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
  // The group's first coordinator never logged in, so has no name yet: it sorts first.
  expect(members.map((m) => m.name)).toEqual(["", "Anna", "Éva", "Zoë"]);
  for (const member of members) {
    expect(Object.keys(member).sort()).toEqual(["isCoordinator", "membershipId", "name", "userId"]);
  }
  expect(members[2]).toEqual({
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

const system = { kind: "system" } as const;
let freshGroups = 0;

/** A new group of the organization with one coordinator, and that coordinator's membership. */
async function groupWithCoordinator() {
  const n = freshGroups++;
  const group = await createWorkingGroup(
    t!.db,
    {
      organizationId,
      name: `Vers ${n}`,
      city: "Enschede",
      coordinatorEmail: `vers-${n}@example.test`,
    },
    system,
  );
  const [membership] = await t!.db
    .select({ id: workingGroupMemberships.id })
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.workingGroupId, group.id));
  return {
    workingGroupId: group.id,
    userId: group.coordinatorUserId,
    membershipId: membership!.id,
  };
}

const coordinatorsOf = async (workingGroupId: string) =>
  t!.db
    .select({ id: workingGroupMemberships.id })
    .from(workingGroupMemberships)
    .where(
      and(
        eq(workingGroupMemberships.workingGroupId, workingGroupId),
        eq(workingGroupMemberships.isCoordinator, true),
      ),
    );

test("removing the last coordinator of an active group is last_coordinator and changes nothing", async () => {
  const group = await groupWithCoordinator();
  for (const expectedIsCoordinator of [true, undefined]) {
    expect(
      await removeMembership(t!.db, {
        membershipId: group.membershipId,
        removedBy: group.userId,
        expectedIsCoordinator,
      }),
    ).toEqual({ outcome: "last_coordinator" });
  }
  expect(await getMembership(t!.db, group.membershipId)).not.toBeNull();
  const removed = await t!.db
    .select()
    .from(auditLogEntries)
    .where(
      and(
        eq(auditLogEntries.subjectId, group.userId),
        eq(auditLogEntries.action, "membership.removed"),
      ),
    );
  expect(removed).toEqual([]);

  // In a group that is switched off, the last coordinator can go.
  await updateWorkingGroup(
    t!.db,
    { workingGroupId: group.workingGroupId, patch: { active: false } },
    system,
  );
  expect(
    await removeMembership(t!.db, {
      membershipId: group.membershipId,
      removedBy: group.userId,
      expectedIsCoordinator: true,
    }),
  ).toEqual({ outcome: "removed" });
});

test("a coordinator removed and another losing the role at the same moment leave one", async () => {
  const group = await groupWithCoordinator();
  const second = await grantCoordinator(
    t!.db,
    { email: "tweede-vers@example.test", workingGroupId: group.workingGroupId },
    system,
  );
  const [secondMembership] = await t!.db
    .select({ id: workingGroupMemberships.id })
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.userId, second.userId));
  // A share lock on the group's memberships lets both read and count, then holds both at their
  // write (or, with the group lock, one at its write and the other at the lock), so they overlap
  // every time.
  const held = await holdLock(t!.db, (tx) =>
    tx.execute(
      sql`select id from working_group_memberships where working_group_id = ${group.workingGroupId} for share`,
    ),
  );
  const changes = Promise.allSettled([
    removeMembership(t!.db, {
      membershipId: group.membershipId,
      removedBy: second.userId,
      expectedIsCoordinator: true,
    }),
    setCoordinator(t!.db, { membershipId: secondMembership!.id, isCoordinator: false }, system),
  ]);
  await waitUntilBlocked(t!.db, 2);
  await held.release();
  const [removal, revoke] = await changes;
  const removed = removal.status === "fulfilled" && removal.value.outcome === "removed";
  const revoked = revoke.status === "fulfilled";
  expect([removed, revoked].filter(Boolean)).toHaveLength(1);
  if (removed) {
    expect(revoke).toMatchObject({ status: "rejected", reason: { code: "last_coordinator" } });
  } else {
    expect(removal).toEqual({ status: "fulfilled", value: { outcome: "last_coordinator" } });
  }
  expect(await coordinatorsOf(group.workingGroupId)).toHaveLength(1);
});

test("two removals of the two coordinators at the same moment leave one", async () => {
  const group = await groupWithCoordinator();
  const second = await grantCoordinator(
    t!.db,
    { email: "derde-vers@example.test", workingGroupId: group.workingGroupId },
    system,
  );
  const [secondMembership] = await t!.db
    .select({ id: workingGroupMemberships.id })
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.userId, second.userId));
  const results = await Promise.all(
    [group.membershipId, secondMembership!.id].map((membershipId) =>
      removeMembership(t!.db, {
        membershipId,
        removedBy: group.userId,
        expectedIsCoordinator: true,
      }),
    ),
  );
  expect(results.map((r) => r.outcome).sort()).toEqual(["last_coordinator", "removed"]);
  expect(await coordinatorsOf(group.workingGroupId)).toHaveLength(1);
});

test("getMember gives one member with contact details and hasLoggedIn, or null", async () => {
  const m = await addMember("Eén");
  expect(await getMember(t!.db, m.membershipId)).toEqual({
    membershipId: m.membershipId,
    userId: m.userId,
    name: "Eén",
    isCoordinator: false,
    email: expect.stringMatching(/@example\.test$/),
    phone: "06 11112222",
    hasLoggedIn: false,
  });
  expect(await getMember(t!.db, randomUUID())).toBeNull();
  await t!.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, m.userId));
  expect(await getMember(t!.db, m.membershipId)).toBeNull();
});
