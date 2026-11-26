import { expect, test } from "vitest";
import { accountSummarySchema, findAccountRequestSchema } from "./accounts";
import { accountSummaryFixture, accountWithoutGroupsFixture } from "./fixtures";

test("the fixtures match their schema", () => {
  for (const fixture of [accountSummaryFixture, accountWithoutGroupsFixture]) {
    expect(accountSummarySchema.parse(fixture)).toEqual(fixture);
  }
});

test("the lookup trims and lowercases the address, and refuses a part of one or another key", () => {
  expect(findAccountRequestSchema.parse({ email: " Noor@Example.TEST " })).toEqual({
    email: "noor@example.test",
  });
  for (const body of [{ email: "noor" }, { email: "%@example" }, {}, { email: "a@b.test", x: 1 }]) {
    expect(findAccountRequestSchema.safeParse(body).success).toBe(false);
  }
});
