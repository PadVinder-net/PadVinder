import { createDb } from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { createTestLogger } from "@padvinder/logging/testing";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, expect, test } from "vitest";
import { HEARTBEAT_QUEUE, registerHeartbeatJob } from "./heartbeat";

let t: TestDatabase | undefined;
let boss: PgBoss;
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

test("a failing handler is logged and the job is not marked completed", async () => {
  const { db, pool } = createDb(t!.url);
  await pool.end(); // Every query now rejects.
  const { logger, entries } = createTestLogger();

  await registerHeartbeatJob(boss, db, logger);
  const jobId = await boss.send(HEARTBEAT_QUEUE);

  // The handler logs before pg-boss records the failure, so wait for the job state itself: it is
  // "active" until then. The bound covers pg-boss's default 2 s idle poll plus the commit.
  await expect
    .poll(async () => (await boss.getJobById(HEARTBEAT_QUEUE, jobId!))?.state, { timeout: 10_000 })
    .toBeOneOf(["retry", "failed"]);
  expect(entries()).toContainEqual(
    expect.objectContaining({
      level: "error",
      msg: "Heartbeat job failed",
      job: { name: "heartbeat", id: expect.any(String) },
      err: expect.objectContaining({ type: "Error" }),
    }),
  );
});
