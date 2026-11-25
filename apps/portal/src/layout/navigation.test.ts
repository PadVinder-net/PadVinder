import {
  applicantMeFixture,
  coordinatorMeFixture,
  meFixture,
  platformAdminMeFixture,
  twoOrganizationsMeFixture,
} from "@padvinder/contracts/fixtures";
import type { MeResponse } from "@padvinder/contracts";
import { expect, test } from "vitest";
import { managesSomething, navigationFor } from "./navigation";

/** An organization admin without any membership. */
const organizationAdminMe: MeResponse = {
  ...applicantMeFixture,
  organizationAdminOf: twoOrganizationsMeFixture.organizationAdminOf,
};

test("navigationFor", () => {
  expect(navigationFor(platformAdminMeFixture)).toEqual([
    { label: "Soorten", to: "/species" },
    { label: "Systeemstatus", to: "/system" },
  ]);
  expect(navigationFor(coordinatorMeFixture)).toEqual([]);
  expect(navigationFor(organizationAdminMe)).toEqual([]);
  expect(navigationFor(meFixture)).toEqual([]);
  expect(navigationFor(applicantMeFixture)).toEqual([]);
});

test("managesSomething", () => {
  expect(managesSomething(platformAdminMeFixture)).toBe(true);
  expect(managesSomething(organizationAdminMe)).toBe(true);
  expect(managesSomething(coordinatorMeFixture)).toBe(true);
  expect(managesSomething(meFixture)).toBe(false);
  expect(managesSomething(applicantMeFixture)).toBe(false);
});
