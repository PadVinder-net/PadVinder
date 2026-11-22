import { expect, test } from "vitest";
import {
  createMembershipRequestSchema,
  membershipRequestSchema,
  membershipRequestStatusSchema,
} from "./membership-requests";
import { meResponseSchema } from "./me";
import {
  pendingRequestFixture,
  rejectedMeFixture,
  rejectedRequestFixture,
  waitingMeFixture,
} from "./fixtures";

const body = {
  id: "0192f3c0-0000-7000-8000-0000000000d9",
  workingGroupId: "0192f3c0-0000-7000-8000-0000000000b1",
  requestedAt: "2027-01-10T19:00:00+01:00",
};

test("the statuses", () =>
  expect(membershipRequestStatusSchema.options).toEqual([
    "pending",
    "approved",
    "rejected",
    "withdrawn",
  ]));

test("accepts a request with a UUIDv7 and a time with an offset", () =>
  expect(createMembershipRequestSchema.parse(body)).toEqual(body));

test.each([
  ["a UUIDv4 id", { ...body, id: "9b2f6c1e-3d4a-4f5b-8c6d-7e8f9a0b1c2d" }],
  ["no id", { ...body, id: undefined }],
  ["a working group that is not a UUID", { ...body, workingGroupId: "noord" }],
  ["a time without an offset", { ...body, requestedAt: "2027-01-10T19:00:00" }],
  ["no time", { ...body, requestedAt: undefined }],
])("rejects %s", (_name, value) =>
  expect(createMembershipRequestSchema.safeParse(value).success).toBe(false),
);

test.each([pendingRequestFixture, rejectedRequestFixture])(
  "the request fixtures parse",
  (fixture) => expect(membershipRequestSchema.parse(fixture)).toEqual(fixture),
);

test("the waiting and rejected me fixtures parse and have no membership", () => {
  for (const [fixture, status] of [
    [waitingMeFixture, "pending"],
    [rejectedMeFixture, "rejected"],
  ] as const) {
    expect(meResponseSchema.parse(fixture)).toEqual(fixture);
    expect(fixture.memberships).toEqual([]);
    expect(fixture.membershipRequest?.status).toBe(status);
  }
  expect(pendingRequestFixture.decidedAt).toBeNull();
  expect(rejectedRequestFixture.decidedAt).not.toBeNull();
});
