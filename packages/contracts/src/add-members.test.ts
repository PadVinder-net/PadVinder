import { expect, test } from "vitest";
import {
  addMembersRequestSchema,
  addMembersResponseSchema,
  MAX_ADDRESSES_PER_REQUEST,
} from "./add-members";
import { addMembersResultFixture } from "./fixtures/add-members";

test("the fixture matches the schema and holds every outcome", () => {
  expect(addMembersResponseSchema.parse(addMembersResultFixture)).toEqual(addMembersResultFixture);
  expect(addMembersResultFixture.results.map((r) => r.outcome).sort()).toEqual([
    "added",
    "already_member",
    "approved",
    "invalid",
    "invited",
  ]);
});

test("the request takes any texts, 1 to 1000, and no other key", () => {
  expect(addMembersRequestSchema.safeParse({ emails: ["jan@"] }).success).toBe(true);
  expect(addMembersRequestSchema.safeParse({ emails: [] }).success).toBe(false);
  expect(addMembersRequestSchema.safeParse({ emails: Array(1001).fill("a") }).success).toBe(false);
  expect(addMembersRequestSchema.safeParse({ emails: ["a".repeat(321)] }).success).toBe(false);
  expect(addMembersRequestSchema.safeParse({ emails: ["a"], extra: 1 }).success).toBe(false);
  expect(MAX_ADDRESSES_PER_REQUEST).toBe(200);
});
