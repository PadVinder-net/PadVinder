import { expect, test } from "vitest";
import {
  audienceOf,
  LIVE_EVENT_TYPES,
  liveEventAudiences,
  liveEventSchema,
  type LiveEventType,
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
  expect(LIVE_EVENT_TYPES).toEqual(["worker-heartbeat"]);
});

test("the worker heartbeat is for platform admins", () => {
  expect(liveEventAudiences["worker-heartbeat"]).toBe("platform-admins");
  expect(audienceOf("worker-heartbeat")).toBe("platform-admins");
});

test("an event type without a declared audience is for platform admins", () => {
  // A type added to the union without an entry in `liveEventAudiences`, or a key of Object.
  expect(audienceOf("not-declared" as LiveEventType)).toBe("platform-admins");
  expect(audienceOf("toString" as LiveEventType)).toBe("platform-admins");
});
