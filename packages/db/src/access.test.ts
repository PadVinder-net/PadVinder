import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getAccess } from "./access";
import {
  organizationAdmins,
  organizations,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

async function insertUser(email: string): Promise<string> {
  const [row] = await t!.db
    .insert(users)
    .values({ name: "", email, emailVerified: true })
    .returning({ id: users.id });
  return row!.id;
}

async function insertOrganization(name: string): Promise<string> {
  const [row] = await t!.db
    .insert(organizations)
    .values({ name })
    .returning({ id: organizations.id });
  return row!.id;
}

async function insertGroup(organizationId: string, name: string, active = true): Promise<string> {
  const [row] = await t!.db
    .insert(workingGroups)
    .values({ organizationId, name, city: "Enschede", active })
    .returning({ id: workingGroups.id });
  return row!.id;
}

test("a user without rows has no access", async () => {
  const userId = await insertUser("none@example.test");
  expect(await getAccess(t!.db, userId)).toEqual({
    isPlatformAdmin: false,
    memberships: [],
    adminOfOrganizationIds: [],
  });
});

test("memberships carry the organization of their working group", async () => {
  const userId = await insertUser("both@example.test");
  const a = await insertOrganization("Organisatie A");
  const b = await insertOrganization("Organisatie B");
  const a1 = await insertGroup(a, "Groep A1");
  const b1 = await insertGroup(b, "Groep B1");
  await t!.db.insert(workingGroupMemberships).values([
    { userId, workingGroupId: a1, isCoordinator: true },
    { userId, workingGroupId: b1, isCoordinator: false },
  ]);
  const access = await getAccess(t!.db, userId);
  expect(access?.memberships).toHaveLength(2);
  expect(access?.memberships).toEqual(
    expect.arrayContaining([
      {
        membershipId: expect.any(String),
        workingGroupId: a1,
        organizationId: a,
        isCoordinator: true,
      },
      {
        membershipId: expect.any(String),
        workingGroupId: b1,
        organizationId: b,
        isCoordinator: false,
      },
    ]),
  );
});

test("an inactive working group gives no membership", async () => {
  const userId = await insertUser("inactive@example.test");
  const org = await insertOrganization("Organisatie C");
  const active = await insertGroup(org, "Actief");
  const inactive = await insertGroup(org, "Gestopt", false);
  await t!.db.insert(workingGroupMemberships).values([
    { userId, workingGroupId: active, isCoordinator: false },
    { userId, workingGroupId: inactive, isCoordinator: true },
  ]);
  const access = await getAccess(t!.db, userId);
  expect(access?.memberships.map((m) => m.workingGroupId)).toEqual([active]);
});

test("organization admin rows and the platform flag are reported", async () => {
  const userId = await insertUser("admin@example.test");
  const org = await insertOrganization("Organisatie D");
  await t!.db.insert(organizationAdmins).values({ userId, organizationId: org });
  await t!.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, userId));
  expect(await getAccess(t!.db, userId)).toEqual({
    isPlatformAdmin: true,
    memberships: [],
    adminOfOrganizationIds: [org],
  });
});

test("an unknown user is null", async () => {
  expect(await getAccess(t!.db, "019e0000-0000-7000-8000-000000000000")).toBeNull();
});

test("a new membership is a volunteer, not a coordinator", async () => {
  const userId = await insertUser("default@example.test");
  const group = await insertGroup(await insertOrganization("Organisatie Z"), "Groep Z1");
  await t!.db.insert(workingGroupMemberships).values({ userId, workingGroupId: group });
  expect((await getAccess(t!.db, userId))?.memberships).toMatchObject([{ isCoordinator: false }]);
});

test("one user cannot be a member of one group twice", async () => {
  const userId = await insertUser("twice@example.test");
  const org = await insertOrganization("Organisatie E");
  const group = await insertGroup(org, "Groep E1");
  await t!.db
    .insert(workingGroupMemberships)
    .values({ userId, workingGroupId: group, isCoordinator: false });
  await expect(
    t!.db
      .insert(workingGroupMemberships)
      .values({ userId, workingGroupId: group, isCoordinator: true }),
  ).rejects.toThrow();
});

test("a working group name is unique within an organization only", async () => {
  const a = await insertOrganization("Organisatie F");
  const b = await insertOrganization("Organisatie G");
  await insertGroup(a, "Dezelfde naam");
  await insertGroup(b, "Dezelfde naam");
  await expect(insertGroup(a, "Dezelfde naam")).rejects.toThrow();
});
