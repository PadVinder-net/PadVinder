import { expect, test } from "vitest";
import { parseEmailLines } from "./email-lines";

test("parseEmailLines names each wrong line by its number, counting empty lines", () => {
  expect(
    parseEmailLines(
      "noor@example.test\r\n\r\njan@\n  Bram@Example.test \t\nJan Jansen <jan@example.test>",
    ),
  ).toEqual({
    emails: ["noor@example.test", "Bram@Example.test"],
    errors: [
      { line: 3, text: "jan@" },
      { line: 5, text: "Jan Jansen <jan@example.test>" },
    ],
  });
});

test("parseEmailLines of an empty text or only empty lines has no emails and no errors", () => {
  expect(parseEmailLines("")).toEqual({ emails: [], errors: [] });
  expect(parseEmailLines("\n \r\n\t\r")).toEqual({ emails: [], errors: [] });
});

test("parseEmailLines splits on a lone carriage return", () => {
  expect(parseEmailLines("a@example.test\rb@example.test").emails).toHaveLength(2);
});
