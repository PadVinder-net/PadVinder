import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { afterAll, beforeAll, expect, test } from "vitest";
import { spawnFixture } from "./spawn-fixture";
import { startFakeSentry } from "./testing";

let database: TestDatabase | undefined;
let fake: Awaited<ReturnType<typeof startFakeSentry>> | undefined;

beforeAll(async () => {
  database = await createTestDatabase();
  fake = await startFakeSentry();
});

afterAll(async () => {
  await fake?.close();
  await database?.drop();
});

test("a query after startServerMonitoring is a db span; no value reaches Sentry", async () => {
  const { code, stderr } = await spawnFixture("src/instrumentation-fixture.ts", {
    SENTRY_DSN: fake!.dsn,
    DATABASE_URL: database!.url,
  });
  expect(stderr).toBe("");
  expect(code).toBe(0);
  const transaction = fake!.transactions().find((tx) => tx.transaction === "fixture");
  expect(transaction?.spans?.some((span) => span.op === "db")).toBe(true);
  expect(fake!.bodies().join("")).not.toContain("noor@example.test");
}, 15_000);
