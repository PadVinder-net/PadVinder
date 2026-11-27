import type { Organization, OrganizationDetail } from "../organizations";

/** The two seeded organizations, one with and one without a contact address. */
export const organizationsFixture: Organization[] = [
  {
    id: "0192f3c0-0000-7000-8000-0000000000a2",
    name: "Paddenwerkgroep Fictiefdorp",
    contactEmail: null,
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000a1",
    name: "Paddentrek Voorbeeldstad",
    contactEmail: "contact@example.test",
  },
];

/** An organization with two admins: one who logged in, and one who never did (no name yet). */
export const organizationDetailFixture: OrganizationDetail = {
  ...organizationsFixture[1]!,
  admins: [
    {
      userId: "0192f3c0-0000-7000-8000-0000000000c1",
      name: "Beheerder Voorbeeld",
      email: "beheerder@example.test",
      hasLoggedIn: true,
      hasPasskey: true,
      mayResetPasskeys: false,
    },
    {
      userId: "0192f3c0-0000-7000-8000-0000000000c2",
      name: "",
      email: "nieuw@example.test",
      hasLoggedIn: false,
      hasPasskey: false,
      mayResetPasskeys: false,
    },
  ],
};
