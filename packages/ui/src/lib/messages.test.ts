import { loginErrors } from "@padvinder/contracts";
import { expect, test } from "vitest";
import { apiErrorMessage, connectionMessage, loginErrorMessage } from "./messages";

test("every login error has its own Dutch text", () => {
  const texts = loginErrors.map(loginErrorMessage);
  for (const text of texts) expect(text).toMatch(/^[A-Z].{10,}\.$/);
  expect(new Set(texts).size).toBe(loginErrors.length);
  expect(loginErrorMessage("wrong_code")).toBe("Deze code klopt niet. Kijk nog eens in je mail.");
  expect(loginErrorMessage("failed")).toBe(connectionMessage);
});

test("the daily limit does not promise a quarter of an hour", () => {
  expect(loginErrorMessage("too_many_codes_today")).not.toMatch(/kwartier/);
  expect(loginErrorMessage("too_busy")).not.toMatch(/nieuwe code/);
});

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
  ["internal_error", connectionMessage],
  ["something_new", connectionMessage],
  ["toString", connectionMessage],
  [null, connectionMessage],
])("apiErrorMessage(%s)", (code, text) => {
  expect(apiErrorMessage(code)).toBe(text);
});
