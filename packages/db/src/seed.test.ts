import { afterEach, beforeEach, expect, test } from "vitest";
import { listOrganizations } from "./admin";
import { eq } from "drizzle-orm";
import {
  auditLogEntries,
  membershipRequests,
  organizationAdmins,
  organizations,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";
import { assertLocalSeed, seed, SEED_MEMBERSHIP_REQUEST_ID } from "./seed";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => {
  await t?.drop();
});

test("the seed creates the organizations, groups and people", async () => {
  await seed(t!.db);
  const organizations = await listOrganizations(t!.db);
  expect(organizations.map((o) => [o.name, o.workingGroups.map((g) => g.name)])).toEqual([
    ["Paddentrek Voorbeeldstad", ["Noord", "Zuid"]],
    ["Paddenwerkgroep Fictiefdorp", ["Dorp"]],
  ]);
  expect(await t!.db.select().from(users)).toHaveLength(9);
});

async function adminsByOrganization() {
  const rows = await t!.db
    .select({ organization: organizations.name, email: users.email })
    .from(organizationAdmins)
    .innerJoin(organizations, eq(organizations.id, organizationAdmins.organizationId))
    .innerJoin(users, eq(users.id, organizationAdmins.userId));
  return rows.sort((a, b) => a.organization.localeCompare(b.organization));
}

test("every organization has its admin, and Voorbeeldstad a contact address", async () => {
  await seed(t!.db);
  expect(await adminsByOrganization()).toEqual([
    { organization: "Paddentrek Voorbeeldstad", email: "beheerder@example.test" },
    { organization: "Paddenwerkgroep Fictiefdorp", email: "beheerder-fictiefdorp@example.test" },
  ]);
  const contacts = await t!.db
    .select({ name: organizations.name, contactEmail: organizations.contactEmail })
    .from(organizations);
  expect(contacts.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
    { name: "Paddentrek Voorbeeldstad", contactEmail: "contact-voorbeeldstad@example.test" },
    { name: "Paddenwerkgroep Fictiefdorp", contactEmail: null },
  ]);
  const [fenna] = await t!.db
    .select()
    .from(users)
    .where(eq(users.email, "beheerder-fictiefdorp@example.test"));
  expect(fenna?.name).toBe("Fenna Fictief");
});

test("organizations that existed without an admin get one", async () => {
  // The shape of a database seeded before organizations had to have an admin.
  await t!.db
    .insert(organizations)
    .values([{ name: "Paddentrek Voorbeeldstad" }, { name: "Paddenwerkgroep Fictiefdorp" }]);
  await seed(t!.db);
  expect(await t!.db.select().from(organizations)).toHaveLength(2);
  expect(await adminsByOrganization()).toEqual([
    { organization: "Paddentrek Voorbeeldstad", email: "beheerder@example.test" },
    { organization: "Paddenwerkgroep Fictiefdorp", email: "beheerder-fictiefdorp@example.test" },
  ]);
  const audit = await t!.db.select().from(auditLogEntries);
  await seed(t!.db);
  expect(await t!.db.select().from(auditLogEntries)).toHaveLength(audit.length);
});

test("everyone with a name has logged in, and a second run keeps the moment", async () => {
  await seed(t!.db);
  const first = await t!.db.select().from(users);
  for (const user of first) {
    if (user.email === "coordinator-dorp@example.test") continue;
    expect(user.lastLoginAt).not.toBeNull();
  }
  await seed(t!.db);
  const second = await t!.db.select().from(users);
  for (const user of second) {
    expect(user.lastLoginAt).toEqual(first.find((u) => u.id === user.id)?.lastLoginAt);
  }
});

test("running it twice changes nothing", async () => {
  await seed(t!.db);
  const audit = await t!.db.select().from(auditLogEntries);
  await seed(t!.db);
  expect(await t!.db.select().from(users)).toHaveLength(9);
  expect(await t!.db.select().from(organizationAdmins)).toHaveLength(2);
  expect(await t!.db.select().from(workingGroupMemberships)).toHaveLength(6);
  expect(await t!.db.select().from(membershipRequests)).toHaveLength(1);
  expect(await t!.db.select().from(auditLogEntries)).toHaveLength(audit.length);
  expect(await listOrganizations(t!.db)).toHaveLength(2);
});

test("the applicant has a pending request for Zuid", async () => {
  await seed(t!.db);
  const rows = await t!.db
    .select({
      id: membershipRequests.id,
      status: membershipRequests.status,
      email: users.email,
      group: workingGroups.name,
    })
    .from(membershipRequests)
    .innerJoin(users, eq(users.id, membershipRequests.userId))
    .innerJoin(workingGroups, eq(workingGroups.id, membershipRequests.workingGroupId));
  expect(rows).toEqual([
    {
      id: SEED_MEMBERSHIP_REQUEST_ID,
      status: "pending",
      email: "aanmelder@example.test",
      group: "Zuid",
    },
  ]);
});

test("a second run keeps a request the developer decided", async () => {
  await seed(t!.db);
  await t!.db
    .update(membershipRequests)
    .set({ status: "withdrawn", decidedAt: new Date() })
    .where(eq(membershipRequests.id, SEED_MEMBERSHIP_REQUEST_ID));
  await seed(t!.db);
  const rows = await t!.db.select().from(membershipRequests);
  expect(rows.map((row) => row.status)).toEqual(["withdrawn"]);
});

test("every address ends in @example.test and every person but one has a name", async () => {
  await seed(t!.db);
  for (const user of await t!.db.select().from(users)) {
    expect(user.email).toMatch(/@example\.test$/);
    // The first coordinator of Dorp never logged in, so has no name yet.
    if (user.email === "coordinator-dorp@example.test") continue;
    expect(user.name).not.toBe("");
  }
});

async function coordinatorsByGroup() {
  const rows = await t!.db
    .select({ group: workingGroups.name, email: users.email })
    .from(workingGroupMemberships)
    .innerJoin(workingGroups, eq(workingGroups.id, workingGroupMemberships.workingGroupId))
    .innerJoin(users, eq(users.id, workingGroupMemberships.userId))
    .where(eq(workingGroupMemberships.isCoordinator, true));
  return rows.sort((a, b) => a.group.localeCompare(b.group));
}

const expectedCoordinators = [
  { group: "Dorp", email: "coordinator-dorp@example.test" },
  { group: "Noord", email: "coordinator@example.test" },
  { group: "Zuid", email: "coordinator-zuid@example.test" },
];

test("every working group has a coordinator; Dorp's never logged in", async () => {
  await seed(t!.db);
  expect(await coordinatorsByGroup()).toEqual(expectedCoordinators);
  const byEmail = async (email: string) =>
    (await t!.db.select().from(users).where(eq(users.email, email)))[0];
  expect(await byEmail("coordinator-zuid@example.test")).toMatchObject({ name: "Zoë Zuid" });
  expect((await byEmail("coordinator-zuid@example.test"))?.lastLoginAt).not.toBeNull();
  expect(await byEmail("coordinator-dorp@example.test")).toMatchObject({
    name: "",
    lastLoginAt: null,
  });
});

test("working groups that existed without a coordinator get one", async () => {
  // The shape of a database seeded before working groups had to have a coordinator.
  await t!.db
    .insert(organizations)
    .values([{ name: "Paddentrek Voorbeeldstad" }, { name: "Paddenwerkgroep Fictiefdorp" }]);
  const [voorbeeldstad, fictiefdorp] = await Promise.all(
    ["Paddentrek Voorbeeldstad", "Paddenwerkgroep Fictiefdorp"].map(
      async (name) =>
        (await t!.db.select().from(organizations).where(eq(organizations.name, name)))[0]!.id,
    ),
  );
  await t!.db.insert(workingGroups).values([
    { organizationId: voorbeeldstad!, name: "Noord", city: "Voorbeeldstad" },
    { organizationId: voorbeeldstad!, name: "Zuid", city: "Voorbeeldstad" },
    { organizationId: fictiefdorp!, name: "Dorp", city: "Fictiefdorp" },
  ]);
  await seed(t!.db);
  expect(await t!.db.select().from(workingGroups)).toHaveLength(3);
  expect(await coordinatorsByGroup()).toEqual(expectedCoordinators);
  const audit = await t!.db.select().from(auditLogEntries);
  await seed(t!.db);
  expect(await t!.db.select().from(auditLogEntries)).toHaveLength(audit.length);
});

test("the seed refuses an https origin", () => {
  expect(() => assertLocalSeed("https://padvinder.example")).toThrow(
    "The seed is for local development only.",
  );
  expect(() => assertLocalSeed("http://localhost:4101")).not.toThrow();
  expect(() => assertLocalSeed(undefined)).not.toThrow();
});
