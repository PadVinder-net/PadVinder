import { expect, test } from "vitest";
import { greeting } from "./greeting";

test.each([
  ["Noor de Vries", "Hallo Noor de Vries,"],
  ["", "Hallo,"],
  ["  ", "Hallo,"],
  ["Noor\nBcc: x@example.test", "Hallo Noor Bcc: x@example.test,"],
  ["Noor 2", "Hallo Noor 2,"],
])("greeting(%j) is %j", (name, expected) => expect(greeting(name)).toBe(expected));

test("with withoutDigits, a name that holds a digit gives Hallo,", () => {
  expect(greeting("Noor 2", { withoutDigits: true })).toBe("Hallo,");
  expect(greeting("Noor", { withoutDigits: true })).toBe("Hallo Noor,");
});
