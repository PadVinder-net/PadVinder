import { expect, test } from "vitest";
import { redact } from "./redact.ts";

test("hides a secret and its URL-encoded form", () =>
  expect(redact("pw=a/b+c url=a%2Fb%2Bc", ["a/b+c"])).toBe("pw=*** url=***"));

test("hides the password in a postgres URL", () =>
  expect(redact("postgres://u:s3cret@host:5432/db", [])).toBe("postgres://u:***@host:5432/db"));

test("ignores empty secrets", () => expect(redact("abc", [""])).toBe("abc"));
