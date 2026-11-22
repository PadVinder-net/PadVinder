import { loginErrors } from "@padvinder/contracts";
import { expect, test } from "vitest";
import { connectionMessage, loginErrorMessage } from "./messages";

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
