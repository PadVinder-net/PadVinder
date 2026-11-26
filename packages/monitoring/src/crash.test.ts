import { afterAll, beforeAll, expect, test } from "vitest";
import { spawnFixture } from "./spawn-fixture";
import { startFakeSentry } from "./testing";

let fake: Awaited<ReturnType<typeof startFakeSentry>> | undefined;

beforeAll(async () => {
  fake = await startFakeSentry();
});

afterAll(async () => {
  await fake?.close();
});

test("a crash sends exactly one event before exiting 1", async () => {
  const { code, stdout } = await spawnFixture("src/crash-fixture.ts", { SENTRY_DSN: fake!.dsn });
  expect(code).toBe(1);
  expect(stdout).toContain("Uncaught exception, exiting");
  expect(fake!.events()).toHaveLength(1);
  expect(fake!.events()[0]).toMatchObject({ tags: { service: "api" }, level: "error" });
  expect(fake!.bodies().join("")).not.toContain("a@b.test");
}, 15_000);
