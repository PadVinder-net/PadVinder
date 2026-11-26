import type { AccountSummary } from "../accounts";

const organization = {
  id: "0192f3c0-0000-7000-8000-0000000000a1",
  name: "Paddentrek Voorbeeldstad",
};

/** A coordinator of Noord who is also a volunteer of Zuid. */
export const accountSummaryFixture: AccountSummary = {
  id: "0192f3c0-0000-7000-8000-000000000101",
  name: "Sanne Bakker",
  email: "sanne@example.test",
  hasLoggedIn: true,
  isPlatformAdmin: false,
  organizationAdminOf: [],
  workingGroups: [
    {
      id: "0192f3c0-0000-7000-8000-0000000000b1",
      name: "Noord",
      organization,
      isCoordinator: true,
    },
    {
      id: "0192f3c0-0000-7000-8000-0000000000b7",
      name: "Zuid",
      organization,
      isCoordinator: false,
    },
  ],
};

/** An account that never logged in and has no name, no role and no working group. */
export const accountWithoutGroupsFixture: AccountSummary = {
  id: "0192f3c0-0000-7000-8000-000000000102",
  name: "",
  email: "nog-niet-ingelogd@example.test",
  hasLoggedIn: false,
  isPlatformAdmin: false,
  organizationAdminOf: [],
  workingGroups: [],
};
