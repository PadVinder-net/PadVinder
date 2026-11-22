import { expect, test } from "vitest";
import {
  accessChangedEventSchema,
  LIVE_EVENT_TYPES,
  liveEventAudiences,
  liveEventSchema,
  membershipRequestsChangedEventSchema,
} from "./events";

test("accepts a worker heartbeat", () => {
  const event = { type: "worker-heartbeat", beatAt: "2027-03-01T19:30:00.000Z" };
  expect(liveEventSchema.parse(event)).toEqual(event);
});

test("rejects an unknown type and a missing type", () => {
  expect(
    liveEventSchema.safeParse({ type: "nope", beatAt: "2027-03-01T19:30:00.000Z" }).success,
  ).toBe(false);
  expect(liveEventSchema.safeParse({ beatAt: "2027-03-01T19:30:00.000Z" }).success).toBe(false);
});

test("lists the event types of the union", () => {
  expect(LIVE_EVENT_TYPES).toEqual([
    "worker-heartbeat",
    "membership-requests-changed",
    "access-changed",
  ]);
});

const workingGroupId = "0192f1a0-0000-7000-8000-000000000001";
const organizationId = "0192f1a0-0000-7000-8000-000000000002";
const userId = "0192f1a0-0000-7000-8000-000000000003";

test("accepts membership-requests-changed with the group and its organization", () => {
  const event = { type: "membership-requests-changed", workingGroupId, organizationId };
  expect(membershipRequestsChangedEventSchema.parse(event)).toEqual(event);
  expect(liveEventSchema.parse(event)).toEqual(event);
  expect(
    liveEventSchema.safeParse({ type: "membership-requests-changed", workingGroupId }).success,
  ).toBe(false);
  expect(liveEventSchema.safeParse({ ...event, workingGroupId: "not-a-uuid" }).success).toBe(false);
});

test("accepts access-changed with the user", () => {
  const event = { type: "access-changed", userId };
  expect(accessChangedEventSchema.parse(event)).toEqual(event);
  expect(liveEventSchema.parse(event)).toEqual(event);
  expect(liveEventSchema.safeParse({ type: "access-changed" }).success).toBe(false);
  expect(liveEventSchema.safeParse({ type: "access-changed", userId: "nope" }).success).toBe(false);
});

test("membership-requests-changed is for the group's coordinators, access-changed for the user", () => {
  expect(liveEventAudiences["membership-requests-changed"]).toBe("working-group-coordinators");
  expect(liveEventAudiences["access-changed"]).toBe("user");
});

test("the worker heartbeat is for platform admins", () => {
  expect(liveEventAudiences["worker-heartbeat"]).toBe("platform-admins");
});

test("every event type has a declared audience", () => {
  // The type demands it; this guards against an entry removed with a cast.
  expect(Object.keys(liveEventAudiences).sort()).toEqual([...LIVE_EVENT_TYPES].sort());
});
