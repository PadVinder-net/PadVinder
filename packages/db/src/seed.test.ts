import { afterEach, beforeEach, expect, test } from "vitest";
import { listOrganizations } from "./admin";
import { auditLogEntries, users, workingGroupMemberships } from "./schema";
import { assertLocalSeed, seed } from "./seed";
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
  expect(await t!.db.select().from(users)).toHaveLength(6);
});

test("running it twice changes nothing", async () => {
  await seed(t!.db);
  const audit = await t!.db.select().from(auditLogEntries);
  await seed(t!.db);
  expect(await t!.db.select().from(users)).toHaveLength(6);
  expect(await t!.db.select().from(workingGroupMemberships)).toHaveLength(4);
  expect(await t!.db.select().from(auditLogEntries)).toHaveLength(audit.length);
  expect(await listOrganizations(t!.db)).toHaveLength(2);
});

test("every address ends in @example.test and every person has a name", async () => {
  await seed(t!.db);
  for (const user of await t!.db.select().from(users)) {
    expect(user.email).toMatch(/@example\.test$/);
    expect(user.name).not.toBe("");
  }
});

test("the seed refuses an https origin", () => {
  expect(() => assertLocalSeed("https://padvinder.example")).toThrow(
    "The seed is for local development only.",
  );
  expect(() => assertLocalSeed("http://localhost:4101")).not.toThrow();
  expect(() => assertLocalSeed(undefined)).not.toThrow();
});
