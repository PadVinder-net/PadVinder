import { expect, test } from "vitest";
import { managedWorkingGroupsFixture } from "./fixtures";
import {
  citySchema,
  createWorkingGroupRequestSchema,
  managedWorkingGroupListResponseSchema,
  updateMembershipRequestSchema,
  updateWorkingGroupRequestSchema,
  workingGroupNameSchema,
} from "./managed-working-groups";

test("a name and a city are trimmed", () => {
  expect(workingGroupNameSchema.parse("  Noord ")).toBe("Noord");
  expect(citySchema.parse(" Enschede ")).toBe("Enschede");
});

test.each(["", "   ", "x".repeat(101), "a@b"])("%j is refused as a name and as a city", (text) => {
  expect(workingGroupNameSchema.safeParse(text).success).toBe(false);
  expect(citySchema.safeParse(text).success).toBe(false);
});

test("the fixture matches its schema", () => {
  expect(
    managedWorkingGroupListResponseSchema.parse({ workingGroups: managedWorkingGroupsFixture }),
  ).toEqual({ workingGroups: managedWorkingGroupsFixture });
});

test("create normalizes the address and refuses unknown keys", () => {
  expect(
    createWorkingGroupRequestSchema.parse({
      name: "Noord",
      city: "Enschede",
      coordinatorEmail: " Jan@Example.test ",
    }),
  ).toEqual({ name: "Noord", city: "Enschede", coordinatorEmail: "jan@example.test" });
  expect(
    createWorkingGroupRequestSchema.safeParse({
      name: "Noord",
      city: "Enschede",
      coordinatorEmail: "jan@example.test",
      extra: 1,
    }).success,
  ).toBe(false);
  expect(createWorkingGroupRequestSchema.safeParse({ name: "Noord", city: "X" }).success).toBe(
    false,
  );
});

test("update needs one key and refuses unknown keys", () => {
  expect(updateWorkingGroupRequestSchema.safeParse({}).success).toBe(false);
  expect(updateWorkingGroupRequestSchema.safeParse({ color: "red" }).success).toBe(false);
  expect(updateWorkingGroupRequestSchema.parse({ active: false })).toEqual({ active: false });
  expect(updateMembershipRequestSchema.safeParse({}).success).toBe(false);
  expect(updateMembershipRequestSchema.parse({ isCoordinator: true })).toEqual({
    isCoordinator: true,
  });
});
