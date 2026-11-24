import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createOrganization, createWorkingGroup } from "./admin";
import { workingGroups } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";
import { getWorkingGroup, listWorkingGroupDirectory } from "./working-groups";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});
const system = { kind: "system" } as const;

const group = (organizationId: string, name: string, city = "Voorbeeldstad") =>
  createWorkingGroup(t!.db, { organizationId, name, city }, system);

test("lists active groups of all organizations by name", async () => {
  const one = await createOrganization(t!.db, { name: "Lijst Een" }, system);
  const two = await createOrganization(t!.db, { name: "Lijst Twee" }, system);
  await group(one.id, "Zuid");
  await group(one.id, "Noord");
  await group(two.id, "Dorp");
  const old = await group(two.id, "Oud");
  await t!.db.update(workingGroups).set({ active: false }).where(eq(workingGroups.id, old.id));

  const list = await listWorkingGroupDirectory(t!.db);
  expect(list.map((g) => g.name)).toEqual(["Dorp", "Noord", "Zuid"]);
  expect(list[0]).toEqual({
    id: expect.any(String),
    name: "Dorp",
    city: "Voorbeeldstad",
    organization: { id: two.id, name: "Lijst Twee" },
  });
});

test("sorts Dutch names the Dutch way", async () => {
  const org = await createOrganization(t!.db, { name: "Sorteer" }, system);
  await group(org.id, "Zuid-Oost");
  await group(org.id, "Éénhoorn");
  await group(org.id, "Noord");
  const names = (await listWorkingGroupDirectory(t!.db))
    .filter((g) => g.organization.id === org.id)
    .map((g) => g.name);
  expect(names).toEqual(["Éénhoorn", "Noord", "Zuid-Oost"]);
});

test("getWorkingGroup returns the organization and the active flag", async () => {
  const org = await createOrganization(t!.db, { name: "Een groep" }, system);
  const made = await group(org.id, "Actief");
  expect(await getWorkingGroup(t!.db, made.id)).toEqual({
    workingGroupId: made.id,
    organizationId: org.id,
    name: "Actief",
    active: true,
  });
  await t!.db.update(workingGroups).set({ active: false }).where(eq(workingGroups.id, made.id));
  expect(await getWorkingGroup(t!.db, made.id)).toMatchObject({ active: false });
  expect(await getWorkingGroup(t!.db, "0193a5e0-0000-7000-8000-000000000000")).toBeNull();
});
