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
test("keeps a JSON line valid when the address is in an escaped-quoted string", () => {
  const line = JSON.stringify({ detail: 'rejected "a@b.test" now' });
  const result = scrub(line);
  expect(() => JSON.parse(result)).not.toThrow();
  expect(result).not.toContain("a@b.test");
  expect(JSON.parse(result).detail).toBe('rejected "[email]" now');
});
test("keeps a JSON line valid when the address is followed by a newline", () => {
  const line = JSON.stringify({ msg: "to a@b.test\nnext" });
  const result = scrub(line);
  expect(JSON.parse(result).msg).toBe("to [email]\nnext");
});
