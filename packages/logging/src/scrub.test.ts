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
test.each([
  ["after a newline", "line one\nfoo@b.test"],
  ["after a tab", "tab\tfoo@b.test"],
  ["after a carriage return", "a\rfoo@b.test"],
  ["after a backspace", "a\bfoo@b.test"],
  ["after a form feed", "a\ffoo@b.test"],
  ["after a control character", "a\u0001foo@b.test"],
  ["after an escaped backslash", "a\\foo@b.test"],
  ["after a quote", 'say "foo@b.test"'],
  ["in a quoted string followed by a newline", '"foo@b.test"\nnext'],
  ["at the start", "foo@b.test is gone"],
  ["at the end", "sent to foo@b.test"],
  ["two in a row", "foo@b.test foo2@b.test"],
  ["starting with an escape letter", "x\nnoor@b.test"],
])("keeps JSON valid and removes the address %s", (_name, v) => {
  const result = JSON.parse(scrub(JSON.stringify({ v }))) as { v: string };
  expect(result.v).not.toMatch(/@b\.test/);
  expect(result.v).toContain("[email]");
});

function timed(text: string): number {
  const start = performance.now();
  scrub(text);
  return performance.now() - start;
}
test("a long run without separators is scrubbed in linear time", () => {
  expect(timed("a".repeat(64_000))).toBeLessThan(500);
});
test("a long line of letters with one @ far away is scrubbed in linear time", () => {
  expect(timed(`${"a".repeat(32_000)}@${"b".repeat(32_000)}`)).toBeLessThan(500);
  expect(timed(`x@${"a".repeat(64_000)}`)).toBeLessThan(500);
});
const pnpmFrames = [
  "at Pool.connect (/srv/release/api/node_modules/.pnpm/pg-pool@3.14.0_pg@8.23.1/node_modules/pg-pool/index.js:45:11)",
  "at Manager.work (/srv/release/worker/node_modules/.pnpm/pg-boss@12.38.2/node_modules/pg-boss/dist/manager.js:401:23)",
  "at file:///srv/release/api/node_modules/.pnpm/@sentry+node@11.18.0/node_modules/@sentry/node/build/index.js:1:1",
];
test.each(pnpmFrames)("keeps a pnpm stack frame as it is: %s", (frame) => {
  expect(scrub(frame)).toBe(frame);
  const line = JSON.stringify({ stack: `Error: x\n    ${frame}` });
  expect(scrub(line)).toBe(line);
});
test("still scrubs ordinary addresses and the address of a connection string", () => {
  expect(scrub("to noor@example.test")).toBe("to [email]");
  expect(scrub("to a.b+c@sub.example.test.")).toBe("to [email].");
  expect(scrub("postgres://user:secret@db.host.test:5432/db")).not.toContain("secret@");
});
