import type { MeResponse } from "../me";

const organization = {
  id: "0192f3c0-0000-7000-8000-0000000000a1",
  name: "Paddentrek Voorbeeldstad",
};

const northGroup = {
  id: "0192f3c0-0000-7000-8000-0000000000b1",
  name: "Noord",
  city: "Voorbeeldstad",
  organization,
};

export const meFixture: MeResponse = {
  user: {
    id: "0192f3c0-0000-7000-8000-000000000001",
    name: "Noor de Vries",
    email: "noor@example.test",
    phone: null,
    isPlatformAdmin: false,
  },
  memberships: [
    { id: "0192f3c0-0000-7000-8000-0000000000c1", role: "volunteer", workingGroup: northGroup },
  ],
  organizationAdminOf: [],
};

export const meWithoutNameFixture: MeResponse = {
  ...meFixture,
  user: { ...meFixture.user, name: "" },
};

export const coordinatorMeFixture: MeResponse = {
  ...meFixture,
  memberships: [{ ...meFixture.memberships[0]!, role: "coordinator" }],
};

export const platformAdminMeFixture: MeResponse = {
  ...meFixture,
  user: { ...meFixture.user, isPlatformAdmin: true },
  memberships: [],
};

export const applicantMeFixture: MeResponse = { ...meFixture, memberships: [] };

const otherOrganization = {
  id: "0192f3c0-0000-7000-8000-0000000000a2",
  name: "Waterdieren Overstad",
};

export const twoOrganizationsMeFixture: MeResponse = {
  ...meFixture,
  memberships: [
    ...meFixture.memberships,
    {
      id: "0192f3c0-0000-7000-8000-0000000000c2",
      role: "coordinator",
      workingGroup: {
        id: "0192f3c0-0000-7000-8000-0000000000b2",
        name: "Centrum",
        city: "Overstad",
        organization: otherOrganization,
      },
    },
  ],
  organizationAdminOf: [otherOrganization],
};
