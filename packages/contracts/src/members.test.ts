import { expect, test } from "vitest";
import { membersFixture, membersWithContactFixture } from "./fixtures/members";
import { memberListResponseSchema } from "./members";

test("the fixtures match the schema", () => {
  for (const members of [membersFixture, membersWithContactFixture]) {
    expect(memberListResponseSchema.parse({ members })).toEqual({ members });
  }
});
test("the names-only fixture has no contact keys", () => {
  for (const member of membersFixture) {
    expect(Object.keys(member).sort()).toEqual(["isCoordinator", "membershipId", "name", "userId"]);
  }
});
