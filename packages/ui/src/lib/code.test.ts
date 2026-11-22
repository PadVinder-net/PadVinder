import { expect, test } from "vitest";
import { isCompleteCode, normalizeCode } from "./code";

test.each([
  ["123456", "123456"],
  ["123 456", "123456"],
  ["123-456", "123456"],
  [" 012345\n", "012345"],
  ["12345678", "123456"],
  ["abc", ""],
])("normalizeCode(%j) is %j", (input, expected) => {
  expect(normalizeCode(input)).toBe(expected);
});
test("isCompleteCode needs six digits", () => {
  expect(isCompleteCode("12345")).toBe(false);
  expect(isCompleteCode("123456")).toBe(true);
});
