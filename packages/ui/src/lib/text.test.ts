import { expect, test } from "vitest";
import { capitalizeFirst } from "./text";

test.each([
  ["gewone pad", "Gewone pad"],
  ["Italiaanse kamsalamander", "Italiaanse kamsalamander"],
  ["", ""],
  ["éénstreep", "Éénstreep"],
])("capitalizeFirst(%j) is %j", (input, expected) => {
  expect(capitalizeFirst(input)).toBe(expected);
});
