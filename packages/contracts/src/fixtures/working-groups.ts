import type { WorkingGroupDirectoryResponse, WorkingGroupSummary } from "../working-groups";

const fictiefdorp = {
  id: "0192f3c0-0000-7000-8000-0000000000a2",
  name: "Paddenwerkgroep Fictiefdorp",
};
const voorbeeldstad = {
  id: "0192f3c0-0000-7000-8000-0000000000a1",
  name: "Paddentrek Voorbeeldstad",
};

export const workingGroupsFixture: WorkingGroupSummary[] = [
  {
    id: "0192f3c0-0000-7000-8000-0000000000b4",
    name: "Buitengebied",
    city: "Fictiefdorp",
    organization: fictiefdorp,
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000b5",
    name: "Dorp",
    city: "Fictiefdorp",
    organization: fictiefdorp,
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000b1",
    name: "Noord",
    city: "Voorbeeldstad",
    organization: voorbeeldstad,
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000b6",
    name: "Salamanderbrug",
    city: "Poelwijk",
    organization: voorbeeldstad,
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000000b2",
    name: "Zuid-Oost",
    city: "Voorbeeldstad",
    organization: voorbeeldstad,
  },
];

export const workingGroupDirectoryFixture: WorkingGroupDirectoryResponse = {
  workingGroups: workingGroupsFixture,
};
