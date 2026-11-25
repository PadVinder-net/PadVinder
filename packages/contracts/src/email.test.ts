import { expect, test } from "vitest";
import { emailAddressSchema, isEmailAddress } from "./email";

test.each([
  [" Noor@Example.TEST ", "noor@example.test"],
  ["bram@example.test", "bram@example.test"],
])("%j becomes %j", (input, output) => {
  expect(emailAddressSchema.parse(input)).toBe(output);
  expect(isEmailAddress(input)).toBe(true);
});

test("an address of 254 characters is accepted", () => {
  const address = `${"x".repeat(254 - "@example.test".length)}@example.test`;
  expect(emailAddressSchema.parse(address)).toHaveLength(254);
});

test.each([
  "jan@",
  "jan",
  "",
  "   ",
  "a@b",
  `${"x".repeat(250)}@example.test`,
  "deleted-123@deleted.invalid",
  " Deleted-0192f3c0-0000-7000-8000-000000000001@Deleted.Invalid ",
])("%j is refused", (input) => {
  expect(emailAddressSchema.safeParse(input).success).toBe(false);
  expect(isEmailAddress(input)).toBe(false);
});
