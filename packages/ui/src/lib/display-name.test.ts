import { expect, test } from "vitest";
import { displayName, nameInSentence } from "./display-name";

test("a given name is shown as it is", () => {
  expect(displayName("Noor Jansen")).toBe("Noor Jansen");
  expect(nameInSentence("Noor Jansen")).toBe("Noor Jansen");
});
test("a missing name reads well as a label and in a sentence", () => {
  expect(displayName("  ")).toBe("Naam niet ingevuld");
  expect(nameInSentence("")).toBe("Deze persoon");
});
