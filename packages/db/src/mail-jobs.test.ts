import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { deleteAccount } from "./accounts";
import { createOrganization, createWorkingGroup, grantOrganizationAdmin } from "./admin";
import { loadMailJobData, mailJobSchema, type MailJob } from "./mail-jobs";
import {
  organizationAdmins,
  passkeys,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

const system = { kind: "system" } as const;

let t: TestDatabase | undefined;
let organizationId = "";
let organizationWithoutContactId = "";
let groupId = "";
let groupWithoutContactId = "";
beforeAll(async () => {
  t = await createTestDatabase();
  organizationId = (
    await createOrganization(
      t.db,
      {
        name: "Mail Org",
        adminEmail: "mail-org-admin@example.test",
        contactEmail: "contact-mail-org@example.test",
      },
      system,
    )
  ).id;
  groupId = (
    await createWorkingGroup(
      t.db,
      {
        organizationId,
        name: "Noord",
        city: "Voorbeeldstad",
        coordinatorEmail: "mail-coordinator@example.test",
      },
      system,
    )
  ).id;
  organizationWithoutContactId = (
    await createOrganization(
      t.db,
      { name: "Mail Org Zonder Contact", adminEmail: "mail-org2-admin@example.test" },
      system,
    )
  ).id;
  groupWithoutContactId = (
    await createWorkingGroup(
      t.db,
      {
        organizationId: organizationWithoutContactId,
        name: "Dorp",
        city: "Fictiefdorp",
        coordinatorEmail: "mail-coordinator2@example.test",
      },
      system,
    )
  ).id;
});
afterAll(async () => {
  await t?.drop();
});

async function addUser(name: string): Promise<{ id: string; email: string }> {
  const email = `${randomUUID()}@example.test`;
  const [user] = await t!.db
    .insert(users)
    .values({ name, email, emailVerified: true })
    .returning({ id: users.id });
  return { id: user!.id, email };
}

async function addMembership(
  userId: string,
  workingGroupId = groupId,
  isCoordinator = false,
): Promise<string> {
  const [membership] = await t!.db
    .insert(workingGroupMemberships)
    .values({ userId, workingGroupId, isCoordinator })
    .returning({ id: workingGroupMemberships.id });
  return membership!.id;
}

async function deleteUser(userId: string): Promise<void> {
  const result = await deleteAccount(t!.db, { userId, now: new Date() });
  expect(result.outcome).toBe("deleted");
}

test("a job of each kind parses; a job with a name, an address or an unknown key is refused", () => {
  const jobs: MailJob[] = [
    { kind: "added-to-working-group", membershipId: randomUUID(), byUserId: randomUUID() },
    { kind: "first-coordinator", membershipId: randomUUID(), byUserId: randomUUID() },
    {
      kind: "invited-to-working-group",
      userId: randomUUID(),
      workingGroupId: randomUUID(),
      byUserId: randomUUID(),
    },
    { kind: "organization-admin", userId: randomUUID(), organizationId: randomUUID() },
  ];
  for (const job of jobs) expect(mailJobSchema.parse(job)).toEqual(job);

  const added = jobs[0]!;
  for (const extra of [
    { name: "Carla" },
    { email: "carla@example.test" },
    { to: "carla@example.test" },
    { workingGroupName: "Noord" },
    { unknown: 1 },
  ]) {
    expect(mailJobSchema.safeParse({ ...added, ...extra }).success).toBe(false);
  }
  // IDs are UUIDs, never an address in their place.
  expect(mailJobSchema.safeParse({ ...added, membershipId: "carla@example.test" }).success).toBe(
    false,
  );
  expect(mailJobSchema.safeParse({ ...added, kind: "approved" }).success).toBe(false);
  expect(
    mailJobSchema.safeParse({ kind: "organization-admin", userId: randomUUID() }).success,
  ).toBe(false);
});

test("loads the receiver, the adder's name, the working group and the organization's contact address", async () => {
  const adder = await addUser("Carla");
  const receiver = await addUser("Noor");
  const membershipId = await addMembership(receiver.id, groupId, true);

  for (const kind of ["added-to-working-group", "first-coordinator"] as const) {
    expect(await loadMailJobData(t!.db, { kind, membershipId, byUserId: adder.id })).toEqual({
      kind,
      to: receiver.email,
      recipientName: "Noor",
      byName: "Carla",
      workingGroupName: "Noord",
      contactEmail: "contact-mail-org@example.test",
    });
  }
});

test("without a contact address, contactEmail is null", async () => {
  const adder = await addUser("Carla");
  const receiver = await addUser("Noor");
  const membershipId = await addMembership(receiver.id, groupWithoutContactId);
  expect(
    await loadMailJobData(t!.db, {
      kind: "added-to-working-group",
      membershipId,
      byUserId: adder.id,
    }),
  ).toMatchObject({ workingGroupName: "Dorp", contactEmail: null });
});

test("a receiver who has no name yet gets an empty recipientName", async () => {
  const adder = await addUser("Carla");
  const receiver = await addUser("");
  const membershipId = await addMembership(receiver.id);
  expect(
    await loadMailJobData(t!.db, {
      kind: "added-to-working-group",
      membershipId,
      byUserId: adder.id,
    }),
  ).toMatchObject({ to: receiver.email, recipientName: "" });
});

test("the adder deleted their account: byName is null", async () => {
  const adder = await addUser("Carla");
  const receiver = await addUser("Noor");
  const membershipId = await addMembership(receiver.id);
  await deleteUser(adder.id);
  const data = await loadMailJobData(t!.db, {
    kind: "added-to-working-group",
    membershipId,
    byUserId: adder.id,
  });
  expect(data).toMatchObject({ to: receiver.email, byName: null });
});

test("the adder has no name, or no account at all: byName is null", async () => {
  const receiver = await addUser("Noor");
  const membershipId = await addMembership(receiver.id, groupId, true);
  const nameless = await addUser("");
  for (const byUserId of [nameless.id, randomUUID()]) {
    const data = await loadMailJobData(t!.db, {
      kind: "first-coordinator",
      membershipId,
      byUserId,
    });
    expect(data).toMatchObject({ to: receiver.email, byName: null });
  }
});

test("the membership was removed again: null", async () => {
  const adder = await addUser("Carla");
  const receiver = await addUser("Noor");
  const membershipId = await addMembership(receiver.id, groupId, true);
  await t!.db.delete(workingGroupMemberships).where(eq(workingGroupMemberships.id, membershipId));
  for (const kind of ["added-to-working-group", "first-coordinator"] as const) {
    expect(await loadMailJobData(t!.db, { kind, membershipId, byUserId: adder.id })).toBeNull();
  }
});

test("the receiver deleted their account: null", async () => {
  const adder = await addUser("Carla");
  const member = await addUser("Noor");
  const membershipId = await addMembership(member.id, groupId, true);
  const invitee = await addUser("Piet");
  // The organization's second admin, so deleting this one is not refused as the last admin.
  const admin = await addUser("Anna");
  await grantOrganizationAdmin(t!.db, { email: admin.email, organizationId }, system);
  await deleteUser(member.id);
  await deleteUser(invitee.id);
  await deleteUser(admin.id);

  const jobs: MailJob[] = [
    { kind: "added-to-working-group", membershipId, byUserId: adder.id },
    { kind: "first-coordinator", membershipId, byUserId: adder.id },
    {
      kind: "invited-to-working-group",
      userId: invitee.id,
      workingGroupId: groupId,
      byUserId: adder.id,
    },
    { kind: "organization-admin", userId: admin.id, organizationId },
  ];
  for (const job of jobs) expect(await loadMailJobData(t!.db, job)).toBeNull();
});

test("an invitation loads the receiver, the inviter's name and the working group", async () => {
  const inviter = await addUser("Carla");
  const invitee = await addUser("Piet");
  expect(
    await loadMailJobData(t!.db, {
      kind: "invited-to-working-group",
      userId: invitee.id,
      workingGroupId: groupId,
      byUserId: inviter.id,
    }),
  ).toEqual({
    kind: "invited-to-working-group",
    to: invitee.email,
    recipientName: "Piet",
    byName: "Carla",
    workingGroupName: "Noord",
  });
});

test("an invitation to a working group that does not exist: null", async () => {
  const inviter = await addUser("Carla");
  const invitee = await addUser("Piet");
  expect(
    await loadMailJobData(t!.db, {
      kind: "invited-to-working-group",
      userId: invitee.id,
      workingGroupId: randomUUID(),
      byUserId: inviter.id,
    }),
  ).toBeNull();
});

test("an invitation to a switched-off working group: null; the added mail still goes", async () => {
  const org = (
    await createOrganization(
      t!.db,
      { name: "Mail Org Uit", adminEmail: "mail-org3-admin@example.test" },
      system,
    )
  ).id;
  const off = (
    await createWorkingGroup(
      t!.db,
      {
        organizationId: org,
        name: "Uit",
        city: "Fictiefdorp",
        coordinatorEmail: "mail-coordinator3@example.test",
      },
      system,
    )
  ).id;
  const inviter = await addUser("Carla");
  const invitee = await addUser("Piet");
  const membershipId = await addMembership(invitee.id, off);
  await t!.db.update(workingGroups).set({ active: false }).where(eq(workingGroups.id, off));
  expect(
    await loadMailJobData(t!.db, {
      kind: "invited-to-working-group",
      userId: invitee.id,
      workingGroupId: off,
      byUserId: inviter.id,
    }),
  ).toBeNull();
  expect(
    await loadMailJobData(t!.db, {
      kind: "added-to-working-group",
      membershipId,
      byUserId: inviter.id,
    }),
  ).toMatchObject({ workingGroupName: "Uit" });
});

test("the first-coordinator mail is dropped when the coordinator flag was cleared", async () => {
  const adder = await addUser("Carla");
  const receiver = await addUser("Noor");
  const membershipId = await addMembership(receiver.id, groupId, true);
  const job = { kind: "first-coordinator", membershipId, byUserId: adder.id } as const;
  expect(await loadMailJobData(t!.db, job)).not.toBeNull();
  await t!.db
    .update(workingGroupMemberships)
    .set({ isCoordinator: false })
    .where(eq(workingGroupMemberships.id, membershipId));
  expect(await loadMailJobData(t!.db, job)).toBeNull();
  expect(
    await loadMailJobData(t!.db, {
      kind: "added-to-working-group",
      membershipId,
      byUserId: adder.id,
    }),
  ).not.toBeNull();
});

test("an organization admin's mail loads the receiver and the organization", async () => {
  const admin = await addUser("Anna");
  await grantOrganizationAdmin(t!.db, { email: admin.email, organizationId }, system);
  expect(
    await loadMailJobData(t!.db, { kind: "organization-admin", userId: admin.id, organizationId }),
  ).toEqual({
    kind: "organization-admin",
    to: admin.email,
    recipientName: "Anna",
    organizationName: "Mail Org",
  });
});

test("the admin row is gone: null", async () => {
  const admin = await addUser("Anna");
  await grantOrganizationAdmin(t!.db, { email: admin.email, organizationId }, system);
  await t!.db
    .delete(organizationAdmins)
    .where(
      and(
        eq(organizationAdmins.userId, admin.id),
        eq(organizationAdmins.organizationId, organizationId),
      ),
    );
  expect(
    await loadMailJobData(t!.db, { kind: "organization-admin", userId: admin.id, organizationId }),
  ).toBeNull();
});

async function addPasskey(userId: string): Promise<string> {
  const [row] = await t!.db
    .insert(passkeys)
    .values({
      userId,
      publicKey: "pk",
      credentialID: randomUUID(),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: new Date("2026-11-26T13:05:00Z"),
    })
    .returning({ id: passkeys.id });
  return row!.id;
}

test("a passkey job with an extra key is refused", () => {
  const added = { kind: "passkey-added", userId: randomUUID(), passkeyId: randomUUID() };
  const removed = { kind: "passkeys-removed", userId: randomUUID(), byUserId: randomUUID() };
  expect(mailJobSchema.parse(added)).toEqual(added);
  expect(mailJobSchema.parse(removed)).toEqual(removed);
  for (const extra of [{ name: "Carla" }, { email: "c@example.test" }, { credentialID: "x" }]) {
    expect(mailJobSchema.safeParse({ ...added, ...extra }).success).toBe(false);
    expect(mailJobSchema.safeParse({ ...removed, ...extra }).success).toBe(false);
  }
});

test("passkey-added is dropped when the passkey or the account is gone", async () => {
  const user = await addUser("Noor");
  const passkeyId = await addPasskey(user.id);
  expect(
    await loadMailJobData(t!.db, { kind: "passkey-added", userId: user.id, passkeyId }),
  ).toEqual({
    kind: "passkey-added",
    to: user.email,
    recipientName: "Noor",
    addedAt: new Date("2026-11-26T13:05:00Z"),
  });
  await t!.db.delete(passkeys).where(eq(passkeys.id, passkeyId));
  expect(
    await loadMailJobData(t!.db, { kind: "passkey-added", userId: user.id, passkeyId }),
  ).toBeNull();

  const other = await addUser("Anna");
  const otherPasskey = await addPasskey(other.id);
  await deleteUser(other.id);
  expect(
    await loadMailJobData(t!.db, {
      kind: "passkey-added",
      userId: other.id,
      passkeyId: otherPasskey,
    }),
  ).toBeNull();
});

test("passkeys-removed counts the passkeys left when it is sent", async () => {
  const user = await addUser("Noor");
  const by = await addUser("Carla");
  await addPasskey(user.id);
  await addPasskey(user.id);
  const own = await loadMailJobData(t!.db, {
    kind: "passkeys-removed",
    userId: user.id,
    byUserId: user.id,
  });
  expect(own).toEqual({
    kind: "passkeys-removed",
    to: user.email,
    recipientName: "Noor",
    byOther: false,
    byName: null,
    remaining: 2,
  });
  await t!.db.delete(passkeys).where(eq(passkeys.userId, user.id));
  expect(
    await loadMailJobData(t!.db, { kind: "passkeys-removed", userId: user.id, byUserId: by.id }),
  ).toMatchObject({ byOther: true, byName: "Carla", remaining: 0 });
  await deleteUser(by.id);
  expect(
    await loadMailJobData(t!.db, { kind: "passkeys-removed", userId: user.id, byUserId: by.id }),
  ).toMatchObject({ byOther: true, byName: null });
  await deleteUser(user.id);
  expect(
    await loadMailJobData(t!.db, { kind: "passkeys-removed", userId: user.id, byUserId: by.id }),
  ).toBeNull();
});
