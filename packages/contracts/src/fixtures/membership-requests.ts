import type { MembershipRequest, MembershipRequestForReview } from "../membership-requests";

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

const southEastGroup = {
  id: "0192f3c0-0000-7000-8000-0000000000b2",
  name: "Zuid-Oost",
  city: "Voorbeeldstad",
  organization: northGroup.organization,
};

/** Three pending requests in two groups, oldest first, as a reviewer sees them. */
export const requestsForReviewFixture: MembershipRequestForReview[] = [
  {
    id: "0192f3c0-0000-7000-8000-0000000000d2",
    status: "pending",
    requestedAt: "2027-01-09T20:15:00.000+01:00",
    decidedAt: null,
    workingGroup: northGroup,
    applicant: {
      id: "0192f3c0-0000-7000-8000-000000000002",
      name: "Noor Jansen",
      email: "noor@example.test",
      phone: "06 12345678",
    },
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000d3",
    status: "pending",
    requestedAt: "2027-01-10T08:40:00.000+01:00",
    decidedAt: null,
    workingGroup: northGroup,
    applicant: {
      id: "0192f3c0-0000-7000-8000-000000000003",
      name: "Sem de Vries",
      email: "sem@example.test",
      phone: null,
    },
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000d4",
    status: "pending",
    requestedAt: "2027-01-11T19:05:00.000+01:00",
    decidedAt: null,
    workingGroup: southEastGroup,
    applicant: {
      id: "0192f3c0-0000-7000-8000-000000000004",
      name: "Fleur Bakker",
      email: "fleur@example.test",
      phone: "06 87654321",
    },
  },
];

/** The open requests of every group a reviewer reviews: three in two groups, grouped by group. */
export const reviewableRequestsFixture: MembershipRequestForReview[] = [
  {
    id: "0192f3c0-0000-7000-8000-0000000000e1",
    status: "pending",
    requestedAt: "2027-01-08T18:20:00.000+01:00",
    decidedAt: null,
    workingGroup: northGroup,
    applicant: {
      id: "0192f3c0-0000-7000-8000-000000000005",
      name: "Lotte Visser",
      email: "lotte@example.test",
      phone: "06 11223344",
    },
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000e2",
    status: "pending",
    requestedAt: "2027-01-10T21:00:00.000+01:00",
    decidedAt: null,
    workingGroup: northGroup,
    applicant: {
      id: "0192f3c0-0000-7000-8000-000000000006",
      name: "Daan Smit",
      email: "daan@example.test",
      phone: null,
    },
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000e3",
    status: "pending",
    requestedAt: "2027-01-09T12:10:00.000+01:00",
    decidedAt: null,
    workingGroup: southEastGroup,
    applicant: {
      id: "0192f3c0-0000-7000-8000-000000000007",
      name: "Mila Peters",
      email: "mila@example.test",
      phone: "06 55667788",
    },
  },
];
