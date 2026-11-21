import {
  databaseUnreachableFixture,
  healthyFixture,
  workerStaleFixture,
} from "@padvinder/contracts/fixtures";
import { describe, expect, test } from "vitest";
import { applyWorkerHeartbeat } from "./health-live-updates";

const event = { type: "worker-heartbeat" as const, beatAt: "2027-03-01T19:31:00.000Z" };
const now = new Date("2027-03-01T19:31:05Z");

describe("applyWorkerHeartbeat", () => {
  test("a new heartbeat makes a stale but reachable system ok", () =>
    expect(applyWorkerHeartbeat(workerStaleFixture, event, now)).toMatchObject({
      status: "ok",
      worker: { lastHeartbeatAt: event.beatAt },
    }));

  test("stays degraded when the database is unreachable", () =>
    expect(applyWorkerHeartbeat(databaseUnreachableFixture, event, now).status).toBe("degraded"));

  test("ignores an older event (out of order)", () =>
    expect(
      applyWorkerHeartbeat(
        healthyFixture,
        { type: "worker-heartbeat", beatAt: "2027-03-01T19:00:00.000Z" },
        now,
      ),
    ).toEqual(healthyFixture));
});
