import type { Member } from "../members";

/** What a volunteer sees: names and who is coordinator. */
export const membersFixture: Member[] = [
  {
    membershipId: "0192f3c0-0000-7000-8000-0000000000e1",
    userId: "0192f3c0-0000-7000-8000-0000000000f1",
    name: "Anna de Vries",
    isCoordinator: true,
  },
  {
    membershipId: "0192f3c0-0000-7000-8000-0000000000e2",
    userId: "0192f3c0-0000-7000-8000-0000000000f2",
    name: "Bram Jansen",
    isCoordinator: false,
  },
  {
    membershipId: "0192f3c0-0000-7000-8000-0000000000e3",
    userId: "0192f3c0-0000-7000-8000-0000000000f3",
    name: "Çiğdem Yıldız",
    isCoordinator: false,
  },
];

/** What a coordinator sees: the same people with email address and phone. */
export const membersWithContactFixture: Member[] = [
  { ...membersFixture[0]!, email: "anna@example.test", phone: "06 12345678" },
  { ...membersFixture[1]!, email: "bram@example.test", phone: null },
  { ...membersFixture[2]!, email: "cigdem@example.test", phone: "06 87654321" },
];
