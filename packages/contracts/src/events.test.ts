import { expect, test } from "vitest";
import { LIVE_EVENT_TYPES, liveEventSchema } from "./events";

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
