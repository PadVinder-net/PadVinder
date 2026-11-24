import { expect, test } from "vitest";
import { apiErrorCode } from "./index";

const body = (code: string) => ({ statusCode: 409, error: "Conflict", message: "x", code });

test("apiErrorCode reads the code of an API error body", () => {
  expect(apiErrorCode(body("already_decided"))).toBe("already_decided");
});

test("apiErrorCode is null for a network failure or anything that is not an API error", () => {
  expect(apiErrorCode(new TypeError("Failed to fetch"))).toBeNull();
  expect(apiErrorCode(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBeNull();
  // A proxy's HTML page during a deploy, or an empty body.
  expect(apiErrorCode("<html>502 Bad Gateway</html>")).toBeNull();
  expect(apiErrorCode({})).toBeNull();
  expect(apiErrorCode(null)).toBeNull();
  expect(apiErrorCode(undefined)).toBeNull();
});
