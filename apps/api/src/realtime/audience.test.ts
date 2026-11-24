import type { LiveEventAudience } from "@padvinder/contracts";
import { expect, test } from "vitest";
import type { Actor } from "../permissions/actor";
import { addressOf, shouldDeliver } from "./audience";

function m(workingGroupId: string, organizationId: string, as: "volunteer" | "coordinator") {
  const isCoordinator = as === "coordinator";
  return { membershipId: `m-${workingGroupId}`, workingGroupId, organizationId, isCoordinator };
}

function actor(userId: string, parts: Partial<Omit<Actor, "userId" | "user">>): Actor {
  return {
    userId,
    user: { id: userId, name: "Test", email: "test@example.test", phone: null },
    isPlatformAdmin: false,
    memberships: [],
    adminOfOrganizationIds: [],
    ...parts,
  };
}

const actors = {
  platformAdmin: actor("u-platform-admin", { isPlatformAdmin: true }),
  organizationAdmin: actor("u-organization-admin", { adminOfOrganizationIds: ["o-a"] }),
  coordinator: actor("u-coordinator", { memberships: [m("g-a1", "o-a", "coordinator")] }),
  volunteer: actor("u-volunteer", { memberships: [m("g-a1", "o-a", "volunteer")] }),
  volunteerOtherGroup: actor("u-volunteer-other-group", {
    memberships: [m("g-a2", "o-a", "volunteer")],
  }),
  coordinatorOtherOrganization: actor("u-coordinator-other-organization", {
    memberships: [m("g-b1", "o-b", "coordinator")],
  }),
  adminOtherOrganization: actor("u-admin-other-organization", {
    adminOfOrganizationIds: ["o-b"],
  }),
  applicant: actor("u-applicant", {}),
};

const address = { workingGroupId: "g-a1", organizationId: "o-a", userId: "u-volunteer" };

function reached(audience: LiveEventAudience, to: Parameters<typeof shouldDeliver>[2]): string[] {
  return Object.entries(actors)
    .filter(([, a]) => shouldDeliver(a, audience, to))
    .map(([who]) => who)
    .sort();
}

test.each([
  ["user", ["volunteer"]],
  ["working-group-coordinators", ["platformAdmin", "organizationAdmin", "coordinator"]],
  ["working-group-members", ["platformAdmin", "organizationAdmin", "coordinator", "volunteer"]],
  [
    "organization",
    ["platformAdmin", "organizationAdmin", "coordinator", "volunteer", "volunteerOtherGroup"],
  ],
  ["platform-admins", ["platformAdmin"]],
] as const)("%s reaches exactly %j", (audience, expected) => {
  expect(reached(audience, address)).toEqual([...expected].sort());
});

test("an event for one user reaches a platform admin only when it is addressed to them", () => {
  expect(reached("user", { userId: "u-platform-admin" })).toEqual(["platformAdmin"]);
});

test("an address without the needed field reaches platform admins only, and nobody for user", () => {
  expect(reached("user", { workingGroupId: "g-a1", organizationId: "o-a" })).toEqual([]);
  for (const audience of ["working-group-coordinators", "working-group-members"] as const) {
    expect(reached(audience, { organizationId: "o-a" }), audience).toEqual(["platformAdmin"]);
    expect(reached(audience, { workingGroupId: "g-a1" }), audience).toEqual(["platformAdmin"]);
  }
  expect(reached("organization", { workingGroupId: "g-a1", userId: "u-volunteer" })).toEqual([
    "platformAdmin",
  ]);
  expect(reached("organization", {})).toEqual(["platformAdmin"]);
});

test("a working group in another organization is not the actor's group", () => {
  // Same group ID, other organization: the address must match both.
  const elsewhere = { workingGroupId: "g-a1", organizationId: "o-b" };
  expect(reached("working-group-members", elsewhere)).toEqual([
    "adminOtherOrganization",
    "platformAdmin",
  ]);
});

test("addressOf takes the string ID fields of an event and nothing else", () => {
  expect(addressOf({ type: "worker-heartbeat", beatAt: "2027-03-01T19:30:00.000Z" })).toEqual({});
  const event = {
    type: "worker-heartbeat",
    beatAt: "2027-03-01T19:30:00.000Z",
    userId: "u-1",
    workingGroupId: 7,
    organizationId: "o-a",
  } as unknown as Parameters<typeof addressOf>[0];
  expect(addressOf(event)).toEqual({ userId: "u-1", organizationId: "o-a" });
});
