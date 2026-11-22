import type { MembershipRole } from "@padvinder/db";
import { expect, test } from "vitest";
import type { Actor } from "./actor";
import { authorize, decide, relationTo } from "./rules";

function m(workingGroupId: string, organizationId: string, role: MembershipRole) {
  return { membershipId: `m-${workingGroupId}`, workingGroupId, organizationId, role };
}

function actor(parts: Partial<Omit<Actor, "userId">>): Actor {
  return {
    userId: "u-1",
    isPlatformAdmin: false,
    memberships: [],
    adminOfOrganizationIds: [],
    ...parts,
  };
}

const target = { workingGroupId: "g-a1", organizationId: "o-a" };
const actors = {
  platformAdmin: actor({ isPlatformAdmin: true }),
  organizationAdmin: actor({ adminOfOrganizationIds: ["o-a"] }),
  coordinator: actor({ memberships: [m("g-a1", "o-a", "coordinator")] }),
  volunteer: actor({ memberships: [m("g-a1", "o-a", "volunteer")] }),
  volunteerOtherGroup: actor({ memberships: [m("g-a2", "o-a", "volunteer")] }),
  coordinatorOtherOrganization: actor({ memberships: [m("g-b1", "o-b", "coordinator")] }),
  adminOtherOrganization: actor({ adminOfOrganizationIds: ["o-b"] }),
  applicant: actor({}),
};
type Who = keyof typeof actors;

test.each([
  [
    "workingGroup.listMembers",
    {
      platformAdmin: "allowed",
      organizationAdmin: "allowed",
      coordinator: "allowed",
      volunteer: "allowed",
      volunteerOtherGroup: "hidden",
      coordinatorOtherOrganization: "hidden",
      adminOtherOrganization: "hidden",
      applicant: "hidden",
    },
  ],
  [
    "workingGroup.viewMemberContact",
    {
      platformAdmin: "allowed",
      organizationAdmin: "allowed",
      coordinator: "allowed",
      volunteer: "forbidden",
      volunteerOtherGroup: "hidden",
      coordinatorOtherOrganization: "hidden",
      adminOtherOrganization: "hidden",
      applicant: "hidden",
    },
  ],
  [
    "workingGroup.reviewRequests",
    {
      platformAdmin: "allowed",
      organizationAdmin: "allowed",
      coordinator: "allowed",
      volunteer: "forbidden",
      volunteerOtherGroup: "hidden",
      coordinatorOtherOrganization: "hidden",
      adminOtherOrganization: "hidden",
      applicant: "hidden",
    },
  ],
] as const)("%s", (action, expected) => {
  for (const [who, decision] of Object.entries(expected)) {
    expect(decide(actors[who as Who], { action, target }), who).toBe(decision);
  }
});

test("a coordinator removes a volunteer but not a coordinator", () => {
  const remove = (who: Who, memberRole: MembershipRole) =>
    decide(actors[who], { action: "workingGroup.removeMember", target, memberRole });
  expect(remove("coordinator", "volunteer")).toBe("allowed");
  expect(remove("coordinator", "coordinator")).toBe("forbidden");
  expect(remove("organizationAdmin", "coordinator")).toBe("allowed");
  expect(remove("platformAdmin", "coordinator")).toBe("allowed");
  expect(remove("volunteer", "volunteer")).toBe("forbidden");
  expect(remove("volunteerOtherGroup", "volunteer")).toBe("hidden");
  expect(remove("adminOtherOrganization", "volunteer")).toBe("hidden");
});

test("a coordinator in one organization is an outsider in the other", () => {
  const both = actor({
    memberships: [m("g-a1", "o-a", "coordinator"), m("g-b1", "o-b", "volunteer")],
  });
  expect(relationTo(both, target)).toBe("coordinator");
  expect(relationTo(both, { workingGroupId: "g-b1", organizationId: "o-b" })).toBe("volunteer");
  expect(relationTo(both, { workingGroupId: "g-b2", organizationId: "o-b" })).toBe("outsider");
});

test("the strongest relation wins", () => {
  const both = actor({
    memberships: [m("g-a1", "o-a", "volunteer")],
    adminOfOrganizationIds: ["o-a"],
  });
  expect(relationTo(both, target)).toBe("organizationAdmin");
  expect(
    relationTo(
      actor({ isPlatformAdmin: true, memberships: [m("g-a1", "o-a", "volunteer")] }),
      target,
    ),
  ).toBe("platformAdmin");
});

test("only a platform admin sees database details", () => {
  const permission = { action: "system.viewDatabaseDetails" } as const;
  for (const [who, a] of Object.entries(actors)) {
    expect(decide(a, permission), who).toBe(who === "platformAdmin" ? "allowed" : "forbidden");
  }
});

test("authorize throws 404 for hidden and 403 for forbidden", () => {
  const listMembers = { action: "workingGroup.listMembers", target } as const;
  const contact = { action: "workingGroup.viewMemberContact", target } as const;
  expect(() => authorize(actors.applicant, listMembers)).toThrowError(
    expect.objectContaining({ statusCode: 404, code: "not_found" }),
  );
  expect(() => authorize(actors.volunteer, contact)).toThrowError(
    expect.objectContaining({ statusCode: 403, code: "not_allowed" }),
  );
  expect(() => authorize(actors.coordinator, contact)).not.toThrow();
});
