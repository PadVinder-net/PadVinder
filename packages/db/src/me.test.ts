import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantOrganizationAdmin,
} from "./admin";
import { getMeRoles } from "./me";
import { users, workingGroupMemberships, workingGroups } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});
const system = { kind: "system" } as const;

async function insertUser(email: string): Promise<string> {
  const [row] = await t!.db
    .insert(users)
    .values({ name: "Test", email, emailVerified: true })
    .returning({ id: users.id });
  return row!.id;
}

test("empty lists for an unknown user", async () => {
  expect(await getMeRoles(t!.db, "0193a5e0-0000-7000-8000-000000000000")).toEqual({
    memberships: [],
    organizationAdminOf: [],
  });
});

test("a new user has no memberships and no admin rights", async () => {
  const id = await insertUser("empty-me@example.test");
  expect(await getMeRoles(t!.db, id)).toEqual({
    memberships: [],
    organizationAdminOf: [],
    membershipRequest: null,
  });
});

test("sorts in Dutch order and leaves out inactive groups", async () => {
  const id = await insertUser("sorted-me@example.test");
  const zeta = await createOrganization(t!.db, { name: "Zeta" }, system);
  const eend = await createOrganization(t!.db, { name: "Éend" }, system);
  const alfa = await createOrganization(t!.db, { name: "Alfa" }, system);
  const mk = async (organizationId: string, name: string) =>
    createWorkingGroup(t!.db, { organizationId, name, city: "Enschede" }, system);
  const groups = [
    await mk(zeta.id, "Een"),
    await mk(eend.id, "Zuid"),
    await mk(eend.id, "Ëast"),
    await mk(alfa.id, "Weg"),
  ];
  const inactive = groups[3]!;
  await t!.db.update(workingGroups).set({ active: false }).where(eq(workingGroups.id, inactive.id));
  await t!.db
    .insert(workingGroupMemberships)
    .values(groups.map((g) => ({ userId: id, workingGroupId: g.id, isCoordinator: false })));
  await grantOrganizationAdmin(
    t!.db,
    { email: "sorted-me@example.test", organizationId: zeta.id },
    system,
  );
  await grantOrganizationAdmin(
    t!.db,
    { email: "sorted-me@example.test", organizationId: eend.id },
    system,
  );
  await grantCoordinator(
    t!.db,
    { email: "sorted-me@example.test", workingGroupId: groups[0]!.id },
    system,
  );

  const me = await getMeRoles(t!.db, id);
  expect(
    me!.memberships.map((m) => `${m.workingGroup.organization.name}/${m.workingGroup.name}`),
  ).toEqual(["Éend/Ëast", "Éend/Zuid", "Zeta/Een"]);
  expect(me!.memberships[2]).toMatchObject({ isCoordinator: true });
  expect(me!.organizationAdminOf.map((o) => o.name)).toEqual(["Éend", "Zeta"]);
});
