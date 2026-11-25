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

/** An admin of two organizations, without any membership. */
const twoOrganizationAdminMe: MeResponse = {
  ...applicantMeFixture,
  organizationAdminOf: [
    ...twoOrganizationsMeFixture.organizationAdminOf,
    { id: "0192f3c0-0000-7000-8000-0000000000a1", name: "Paddentrek Voorbeeldstad" },
  ],
};

test("navigationFor puts Aanmeldingen after Werkgroepen for a coordinator", () => {
  expect(navigationFor(coordinatorMeFixture)).toEqual([
    { label: "Werkgroepen", to: "/working-groups" },
    { label: "Aanmeldingen", to: "/membership-requests" },
  ]);
});

test("navigationFor", () => {
  // An admin of exactly one organization goes straight to it.
  expect(navigationFor(twoOrganizationsMeFixture).map((item) => [item.label, item.to])).toEqual([
    ["Werkgroepen", "/working-groups"],
    ["Aanmeldingen", "/membership-requests"],
    ["Organisatie", "/organizations/0192f3c0-0000-7000-8000-0000000000a2"],
  ]);
  expect(navigationFor(organizationAdminMe)).toEqual([
    { label: "Werkgroepen", to: "/working-groups" },
    { label: "Aanmeldingen", to: "/membership-requests" },
    { label: "Organisatie", to: "/organizations/0192f3c0-0000-7000-8000-0000000000a2" },
  ]);
  expect(navigationFor(twoOrganizationAdminMe).map((item) => [item.label, item.to])).toEqual([
    ["Werkgroepen", "/working-groups"],
    ["Aanmeldingen", "/membership-requests"],
    ["Organisaties", "/organizations"],
  ]);
  expect(navigationFor(platformAdminMeFixture).map((item) => item.to)).toEqual([
    "/working-groups",
    "/membership-requests",
    "/organizations",
    "/species",
    "/system",
  ]);
  expect(navigationFor(platformAdminMeFixture).map((item) => item.label)).toEqual([
    "Werkgroepen",
    "Aanmeldingen",
    "Organisaties",
    "Soorten",
    "Systeemstatus",
  ]);
  // A platform admin who also administers one organization sees all of them.
  expect(
    navigationFor({
      ...platformAdminMeFixture,
      organizationAdminOf: twoOrganizationsMeFixture.organizationAdminOf,
    }).map((item) => item.to),
  ).toEqual(["/working-groups", "/membership-requests", "/organizations", "/species", "/system"]);
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
