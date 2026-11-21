import { getLatestHeartbeat } from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Logger } from "../logger";
import { HEARTBEAT_QUEUE, registerHeartbeatJob } from "./heartbeat";

let t: TestDatabase | undefined;
let boss: PgBoss;
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeAll(async () => {
  t = await createTestDatabase();
  boss = new PgBoss(t.url);
  boss.on("error", (error) => console.error(error));
  await boss.start();
});
afterAll(async () => {
  await boss?.stop({ graceful: true, timeout: 5_000 });
  await t?.drop();
});

test("a sent heartbeat job records a beat", async () => {
  await registerHeartbeatJob(boss, t!.db, logger);
  await boss.send(HEARTBEAT_QUEUE);
  await expect.poll(() => getLatestHeartbeat(t!.db), { timeout: 10_000 }).not.toBeNull();
});

test("the cron schedule is registered in Europe/Amsterdam", async () => {
  await registerHeartbeatJob(boss, t!.db, logger);
  const schedules = await boss.getSchedules();
  expect(schedules).toContainEqual(
    expect.objectContaining({
      name: HEARTBEAT_QUEUE,
      cron: "* * * * *",
      timezone: "Europe/Amsterdam",
    }),
  );
});

test("registering twice leaves exactly one schedule", async () => {
  await registerHeartbeatJob(boss, t!.db, logger);
  await registerHeartbeatJob(boss, t!.db, logger);
  const schedules = await boss.getSchedules();
  expect(schedules.filter((schedule) => schedule.name === HEARTBEAT_QUEUE)).toHaveLength(1);
});
