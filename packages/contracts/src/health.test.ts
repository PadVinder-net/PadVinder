import { expect, test } from "vitest";
import { deriveOverallStatus } from "./health";

const now = new Date("2027-03-01T19:31:00Z");

test("degraded without any heartbeat", () =>
  expect(deriveOverallStatus({ databaseReachable: true, lastHeartbeatAt: null, now })).toBe(
    "degraded",
  ));
test("degraded when the database is unreachable", () =>
  expect(deriveOverallStatus({ databaseReachable: false, lastHeartbeatAt: now, now })).toBe(
    "degraded",
  ));
test("ok when the heartbeat is 2:59 old", () =>
  expect(
    deriveOverallStatus({
      databaseReachable: true,
      lastHeartbeatAt: new Date(now.getTime() - 179_000),
      now,
    }),
  ).toBe("ok"));
test("degraded when the heartbeat is 3:01 old", () =>
  expect(
    deriveOverallStatus({
      databaseReachable: true,
      lastHeartbeatAt: new Date(now.getTime() - 181_000),
      now,
    }),
  ).toBe("degraded"));
test("ok when the heartbeat is slightly in the future (clock skew)", () =>
  expect(
    deriveOverallStatus({
      databaseReachable: true,
      lastHeartbeatAt: new Date(now.getTime() + 5_000),
      now,
    }),
  ).toBe("ok"));
