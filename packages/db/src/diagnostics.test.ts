import { afterAll, beforeAll, expect, test } from "vitest";
import { getDatabaseDiagnostics } from "./diagnostics";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

test("reports versions and the latest migration", async () => {
  const d = await getDatabaseDiagnostics(t!.db);
  // Without the distribution suffix, like "18.1", not "18.1 (Debian 18.1-1.pgdg12+2)".
  expect(d.postgresVersion).toMatch(/^\d+\.\d+$/);
  expect(d.postgisVersion).toMatch(/^3\./);
  expect(d.latestMigration?.name).toMatch(/^\d{14}_\w+$/);
  expect(d.latestMigration?.createdAt).toBeInstanceOf(Date);
});
