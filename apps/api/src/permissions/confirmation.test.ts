import { expect, test } from "vitest";
import type { Actor } from "./actor";
import {
  adminConfirmedUntil,
  ADMIN_PASSKEY_CONFIRMATION_WINDOW,
  confirmationOf,
  hasAdminRole,
} from "./confirmation";

const now = new Date("2026-11-26T12:00:00Z");
const base: Actor = {
  userId: "u-1",
  user: { id: "u-1", name: "Test", email: "test@example.test", phone: null },
  passkeyVerifiedAt: null,
  now,
  isPlatformAdmin: false,
  memberships: [],
  adminOfOrganizationIds: [],
};
const agoMs = (ms: number | null) => (ms === null ? null : new Date(now.getTime() - ms));

test.each([
  [null, "none"],
  [0, "recent"],
  [10 * 60 * 1000 - 1, "recent"],
  [10 * 60 * 1000, "confirmed"],
  [24 * 60 * 60 * 1000 - 1, "confirmed"],
  [24 * 60 * 60 * 1000, "none"],
  [-1, "none"],
])("a passkey %j ms ago is %s", (ago, expected) => {
  expect(confirmationOf({ now, passkeyVerifiedAt: agoMs(ago) })).toBe(expected);
});

test("hasAdminRole", () => {
  expect(hasAdminRole(base)).toBe(false);
  expect(hasAdminRole({ ...base, isPlatformAdmin: true })).toBe(true);
  expect(hasAdminRole({ ...base, adminOfOrganizationIds: ["o-a"] })).toBe(true);
});

test("adminConfirmedUntil is passkeyVerifiedAt + 24 h for an admin, null for a non-admin or an unconfirmed session", () => {
  const at = agoMs(60 * 60 * 1000)!;
  const until = new Date(at.getTime() + ADMIN_PASSKEY_CONFIRMATION_WINDOW);
  expect(adminConfirmedUntil({ ...base, isPlatformAdmin: true, passkeyVerifiedAt: at })).toEqual(
    until,
  );
  expect(
    adminConfirmedUntil({ ...base, adminOfOrganizationIds: ["o-a"], passkeyVerifiedAt: at }),
  ).toEqual(until);
  expect(adminConfirmedUntil({ ...base, passkeyVerifiedAt: at })).toBeNull();
  expect(adminConfirmedUntil({ ...base, isPlatformAdmin: true })).toBeNull();
  expect(
    adminConfirmedUntil({ ...base, isPlatformAdmin: true, passkeyVerifiedAt: agoMs(25 * 3600e3) }),
  ).toBeNull();
});
