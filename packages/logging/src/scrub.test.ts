import { expect, test } from "vitest";
import { scrub } from "./scrub";

test("replaces addresses anywhere in a text", () => {
  expect(scrub("could not send to noor@example.test, retry")).toBe(
    "could not send to [email], retry",
  );
  expect(scrub("Key (lower(email))=(a.b+c@sub.example.test) already exists.")).toBe(
    "Key (lower(email))=([email]) already exists.",
  );
  expect(scrub("no address here @ all")).toBe("no address here @ all");
});
test("works on a whole JSON line without crossing quotes", () => {
  expect(scrub('{"to":"a@b.test","msg":"x"}')).toBe('{"to":"[email]","msg":"x"}');
});
