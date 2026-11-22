import { expect, test } from "vitest";
import { apiErrorCodes, apiErrorSchema } from "./errors";

test("accepts an error with and without issues", () => {
  const base = { statusCode: 400, error: "Bad Request", message: "x", code: "invalid_request" };
  expect(apiErrorSchema.parse(base)).toEqual(base);
  const withIssues = { ...base, issues: [{ path: "name", message: "Required" }] };
  expect(apiErrorSchema.parse(withIssues)).toEqual(withIssues);
});

test("rejects a body without a code", () => {
  expect(
    apiErrorSchema.safeParse({ statusCode: 400, error: "Bad Request", message: "x" }).success,
  ).toBe(false);
});

test("the known codes are lowercase snake_case", () => {
  for (const code of Object.values(apiErrorCodes)) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
});
