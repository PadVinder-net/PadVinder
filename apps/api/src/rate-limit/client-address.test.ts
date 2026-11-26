import { expect, test } from "vitest";
import { clientAddress } from "./client-address";

const socket = "192.0.2.1";

test.each([
  ["one IPv4 address", "203.0.113.9", "203.0.113.9"],
  ["one address with spaces", " 203.0.113.9 ", "203.0.113.9"],
  ["an IPv4-mapped IPv6 address", "::ffff:203.0.113.9", "203.0.113.9"],
  ["an IPv6 address, by its /64", "2001:db8:1:2:3:4:5:6", "2001:0db8:0001:0002::/64"],
  ["another address in the same /64", "2001:db8:1:2::9", "2001:0db8:0001:0002::/64"],
  ["two addresses (a list): the socket", "203.0.113.9, 198.51.100.1", socket],
  ["not an address: the socket", "nonsense", socket],
  ["no header: the socket", undefined, socket],
])("%s", (_, forwardedFor, expected) => {
  expect(clientAddress({ headers: { "x-forwarded-for": forwardedFor }, ip: socket })).toBe(
    expected,
  );
});

test("an IPv6 address with a dotted tail counts its groups right", () => {
  expect(clientAddress({ headers: { "x-forwarded-for": "2001:db8::1.2.3.4" }, ip: socket })).toBe(
    "2001:0db8:0000:0000::/64",
  );
  expect(clientAddress({ headers: { "x-forwarded-for": "1:2:3:4:5:6:1.2.3.4" }, ip: socket })).toBe(
    "0001:0002:0003:0004::/64",
  );
});
