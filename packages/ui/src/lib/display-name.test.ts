import { expect, test } from "vitest";
import { displayName, nameInSentence } from "./display-name";

test("a given name is shown as it is", () => {
  expect(displayName("Noor Jansen")).toBe("Noor Jansen");
  expect(nameInSentence("Noor Jansen")).toBe("Noor Jansen");
});
test.each([
  ["Noor", true, "Noor"],
  ["", true, "(nog geen naam)"],
  ["  ", true, "(nog geen naam)"],
  ["", false, "(nog niet ingelogd)"],
  ["Noor", false, "(nog niet ingelogd)"],
  ["", undefined, "(nog geen naam)"],
])("displayName(%j, %j) is %j", (name, hasLoggedIn, expected) => {
  expect(displayName(name, hasLoggedIn)).toBe(expected);
});
test("a missing name reads well in a sentence", () => {
  expect(nameInSentence("")).toBe("Deze persoon");
});
