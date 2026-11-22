import { expect, test } from "vitest";
import { apiErrorCode, apiErrorMessage } from "./index";

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

const fallback = "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";

test.each([
  [
    "too_many_requests",
    "Je hebt vandaag te vaak een aanmelding gestuurd. Probeer het morgen opnieuw.",
  ],
  ["already_decided", "Deze aanmelding is al behandeld."],
  [
    "last_platform_admin",
    "Je bent de enige hoofdbeheerder. Maak eerst iemand anders hoofdbeheerder.",
  ],
  ["not_allowed", "Dit mag je niet doen."],
  ["not_found", "Dit bestaat niet meer."],
  ["membership_changed", "Deze persoon heeft intussen een andere rol. Kijk opnieuw."],
  ["internal_error", fallback],
  ["something_new", fallback],
  [null, fallback],
])("apiErrorMessage(%s)", (code, text) => {
  expect(apiErrorMessage(code)).toBe(text);
});
