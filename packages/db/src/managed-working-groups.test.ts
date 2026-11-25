import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getAccess } from "./access";
import {
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantPlatformAdmin,
  updateWorkingGroup,
} from "./admin";
import { getManagedWorkingGroup, listManagedWorkingGroups } from "./managed-working-groups";
import { membershipRequests, users, workingGroupMemberships } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

const system = { kind: "system" } as const;
let t: TestDatabase | undefined;
const db = () => t!.db;

let alfa = "";
let zeta = "";
const groups: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestDatabase();
  alfa = (await createOrganization(db(), { name: "Alfa", adminEmail: "alfa@example.test" }, system))
    .id;
  zeta = (await createOrganization(db(), { name: "Zeta", adminEmail: "zeta@example.test" }, system))
    .id;
  const group = async (organizationId: string, name: string, coordinatorEmail: string) => {
    groups[name] = (
      await createWorkingGroup(
        db(),
        { organizationId, name, city: `${name}stad`, coordinatorEmail },
        system,
      )
    ).id;
  };
  await group(alfa, "Zuid", "c@example.test");
  await group(alfa, "Éemnes", "alfa-zuid@example.test");
  await group(alfa, "Oost", "alfa-oost@example.test");
  await group(alfa, "Weg", "alfa-weg@example.test");
  await group(zeta, "Dorp", "c@example.test");
  await group(zeta, "Oud", "c@example.test");
  await updateWorkingGroup(db(), { workingGroupId: groups.Weg!, patch: { active: false } }, system);
  await updateWorkingGroup(db(), { workingGroupId: groups.Oud!, patch: { active: false } }, system);
  // The admin of Alfa coordinates one of its groups too.
  await grantCoordinator(
    db(),
    { email: "alfa@example.test", workingGroupId: groups.Oost! },
    system,
  );
  await grantPlatformAdmin(db(), { email: "hoofd@example.test" }, system);
});
afterAll(async () => {
  await t?.drop();
});

async function accessOf(email: string) {
  const [row] = await db().select({ id: users.id }).from(users).where(eq(users.email, email));
  return (await getAccess(db(), row!.id))!;
}

const names = (list: { name: string }[]) => list.map((group) => group.name);

test("a platform admin gets every group, an admin the groups of their organization also when off, a coordinator their active groups, a volunteer none", async () => {
  expect(names(await listManagedWorkingGroups(db(), await accessOf("hoofd@example.test")))).toEqual(
    ["Éemnes", "Oost", "Weg", "Zuid", "Dorp", "Oud"],
  );
  expect(names(await listManagedWorkingGroups(db(), await accessOf("zeta@example.test")))).toEqual([
    "Dorp",
    "Oud",
  ]);
  // c@ coordinates Zuid (Alfa), Dorp (Zeta) and Oud (Zeta, switched off).
  expect(names(await listManagedWorkingGroups(db(), await accessOf("c@example.test")))).toEqual([
    "Zuid",
    "Dorp",
  ]);
  const [volunteer] = await db()
    .insert(users)
    .values({ name: "Vera", email: "v@example.test", emailVerified: true })
    .returning({ id: users.id });
  await db()
    .insert(workingGroupMemberships)
    .values({ userId: volunteer!.id, workingGroupId: groups.Zuid! });
  expect(await listManagedWorkingGroups(db(), await accessOf("v@example.test"))).toEqual([]);
});

test("an admin who also coordinates a group gets it once", async () => {
  const list = await listManagedWorkingGroups(db(), await accessOf("alfa@example.test"));
  expect(names(list)).toEqual(["Éemnes", "Oost", "Weg", "Zuid"]);
});

test("counts members without deleted accounts, and pending requests only", async () => {
  const workingGroupId = groups.Éemnes!;
  const person = async (email: string, deleted = false) => {
    const [row] = await db()
      .insert(users)
      .values({ name: "Persoon", email, deletedAt: deleted ? new Date() : null })
      .returning({ id: users.id });
    return row!.id;
  };
  const member = await person("lid-eemnes@example.test");
  const gone = await person("weg-eemnes@example.test", true);
  await db()
    .insert(workingGroupMemberships)
    .values([
      { userId: member, workingGroupId },
      { userId: gone, workingGroupId },
    ]);
  const now = new Date();
  for (const status of ["pending", "pending", "rejected", "withdrawn", "approved"] as const) {
    await db()
      .insert(membershipRequests)
      .values({
        id: randomUUID(),
        userId: await person(`aanvraag-${randomUUID()}@example.test`),
        workingGroupId,
        status,
        requestedAt: now,
        decidedAt: status === "pending" ? null : now,
      });
  }
  const expected = {
    id: workingGroupId,
    name: "Éemnes",
    city: "Éemnesstad",
    active: true,
    organization: { id: alfa, name: "Alfa" },
    // The first coordinator and the member; not the deleted account.
    memberCount: 2,
    pendingRequestCount: 2,
  };
  expect(await getManagedWorkingGroup(db(), workingGroupId)).toEqual(expected);
  const list = await listManagedWorkingGroups(db(), await accessOf("hoofd@example.test"));
  expect(list.find((group) => group.id === workingGroupId)).toEqual(expected);
  expect(list.find((group) => group.id === groups.Dorp)).toMatchObject({
    organization: { id: zeta, name: "Zeta" },
    memberCount: 1,
    pendingRequestCount: 0,
  });
});

test("getManagedWorkingGroup is null for a group that does not exist", async () => {
  expect(await getManagedWorkingGroup(db(), randomUUID())).toBeNull();
});
