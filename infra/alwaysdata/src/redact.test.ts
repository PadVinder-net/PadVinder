import { expect, test } from "vitest";
import { redact, redactForLog, redactIpAddresses } from "./redact.ts";

test("hides a secret and its URL-encoded form", () =>
  expect(redact("pw=a/b+c url=a%2Fb%2Bc", ["a/b+c"])).toBe("pw=*** url=***"));

test("hides the password in a postgres URL", () =>
  expect(redact("postgres://u:s3cret@host:5432/db", [])).toBe("postgres://u:***@host:5432/db"));

test("ignores empty secrets", () => expect(redact("abc", [""])).toBe("abc"));

test("replaces IPv4 and IPv6 addresses", () => {
  expect(redactIpAddresses("connect ECONNREFUSED 192.0.2.10:5432")).toBe(
    "connect ECONNREFUSED <ip>:5432",
  );
  expect(redactIpAddresses("connect ECONNREFUSED 2001:db8::1")).toBe("connect ECONNREFUSED <ip>");
  expect(redactIpAddresses("[2001:db8::1]:5432, ::1:5432, ::ffff:192.0.2.1, fe80::1%eth0")).toBe(
    "[<ip>]:5432, <ip>, <ip>, <ip>",
  );
  expect(redactIpAddresses("2001:0db8:0000:0000:0000:0000:0000:0001.")).toBe("<ip>.");
});

test("leaves times, versions, ports and commits alone", () => {
  const text =
    "heartbeat 2027-03-01T20:00:30.000Z, release 20270301T200000Z-bbbbbbb, Node 24.11.0, PostgreSQL 18.1, PostGIS 3.6.1, port 8300, HTTP 503, failed with 0: timeout, deadbeef:cafe";
  expect(redactIpAddresses(text)).toBe(text);
});

test("the log filter hides secrets, IP addresses and the account", () =>
  expect(redactForLog("acme: key s3cret from 192.0.2.10 and 2001:db8::1", ["s3cret"], "acme")).toBe(
    "<account>: key *** from <ip> and <ip>",
  ));
