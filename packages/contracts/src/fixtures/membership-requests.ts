import type { MembershipRequest } from "../membership-requests";

const northGroup = {
  id: "0192f3c0-0000-7000-8000-0000000000b1",
  name: "Noord",
  city: "Voorbeeldstad",
  organization: { id: "0192f3c0-0000-7000-8000-0000000000a1", name: "Paddentrek Voorbeeldstad" },
};

export const pendingRequestFixture: MembershipRequest = {
  id: "0192f3c0-0000-7000-8000-0000000000d1",
  status: "pending",
  requestedAt: "2027-01-10T19:00:00.000+01:00",
  decidedAt: null,
  workingGroup: northGroup,
};

export const rejectedRequestFixture: MembershipRequest = {
  ...pendingRequestFixture,
  status: "rejected",
  decidedAt: "2027-01-12T09:30:00.000+01:00",
};
