import type { ManagedWorkingGroup } from "../managed-working-groups";

/** Noord and Zuid-Oost of one organization, and a group of another organization that is off. */
export const managedWorkingGroupsFixture: ManagedWorkingGroup[] = [
  {
    id: "0192f3c0-0000-7000-8000-0000000000b1",
    name: "Noord",
    city: "Voorbeeldstad",
    active: true,
    organization: { id: "0192f3c0-0000-7000-8000-0000000000a1", name: "Paddentrek Voorbeeldstad" },
    memberCount: 12,
    pendingRequestCount: 2,
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000b2",
    name: "Zuid-Oost",
    city: "Voorbeeldstad",
    active: true,
    organization: { id: "0192f3c0-0000-7000-8000-0000000000a1", name: "Paddentrek Voorbeeldstad" },
    memberCount: 3,
    pendingRequestCount: 0,
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000b3",
    name: "Buitengebied",
    city: "Fictiefdorp",
    active: false,
    organization: {
      id: "0192f3c0-0000-7000-8000-0000000000a2",
      name: "Paddenwerkgroep Fictiefdorp",
    },
    memberCount: 5,
    pendingRequestCount: 0,
  },
];
