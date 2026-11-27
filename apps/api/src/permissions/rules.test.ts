import { expect, test } from "vitest";
import type { Actor } from "./actor";
import { authorize, decide, organizationRelationTo, relationTo } from "./rules";

function m(workingGroupId: string, organizationId: string, as: "volunteer" | "coordinator") {
  const isCoordinator = as === "coordinator";
  return { membershipId: `m-${workingGroupId}`, workingGroupId, organizationId, isCoordinator };
}

function actor(parts: Partial<Omit<Actor, "userId" | "user">>): Actor {
  return {
    userId: "u-1",
    user: { id: "u-1", name: "Test", email: "test@example.test", phone: null },
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
    "workingGroup.addMembers",
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
  const remove = (who: Who, memberIsCoordinator: boolean) =>
    decide(actors[who], { action: "workingGroup.removeMember", target, memberIsCoordinator });
  expect(remove("coordinator", false)).toBe("allowed");
  expect(remove("coordinator", true)).toBe("forbidden");
  expect(remove("organizationAdmin", true)).toBe("allowed");
  expect(remove("platformAdmin", true)).toBe("allowed");
  expect(remove("volunteer", false)).toBe("forbidden");
  expect(remove("volunteerOtherGroup", false)).toBe("hidden");
  expect(remove("adminOtherOrganization", false)).toBe("hidden");
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

test("only a platform admin triggers the test error; for others it is forbidden", () => {
  const permission = { action: "system.triggerTestError" } as const;
  for (const [who, a] of Object.entries(actors)) {
    expect(decide(a, permission), who).toBe(who === "platformAdmin" ? "allowed" : "forbidden");
  }
});

test("only a platform admin tests the connection to Sentry; for others it is forbidden", () => {
  const permission = { action: "system.testSentryConnection" } as const;
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

test("only a platform admin manages species; for others it is forbidden, not hidden", () => {
  const permission = { action: "platform.manageSpecies" } as const;
  for (const [who, a] of Object.entries(actors)) {
    expect(decide(a, permission), who).toBe(who === "platformAdmin" ? "allowed" : "forbidden");
  }
  expect(() => authorize(actors.organizationAdmin, permission)).toThrowError(
    expect.objectContaining({ statusCode: 403, code: "not_allowed" }),
  );
  expect(() => authorize(actors.platformAdmin, permission)).not.toThrow();
});

const organizationTarget = { organizationId: "o-a" };
const hiddenForOthers = {
  coordinator: "hidden",
  volunteer: "hidden",
  volunteerOtherGroup: "hidden",
  coordinatorOtherOrganization: "hidden",
  adminOtherOrganization: "hidden",
  applicant: "hidden",
} as const;

test.each([
  ["organization.view", "allowed"],
  ["organization.changeContact", "allowed"],
  ["organization.createWorkingGroup", "allowed"],
  ["organization.rename", "forbidden"],
  ["organization.manageAdmins", "forbidden"],
] as const)("%s", (action, adminDecision) => {
  const expected = {
    platformAdmin: "allowed",
    organizationAdmin: adminDecision,
    ...hiddenForOthers,
  };
  for (const [who, decision] of Object.entries(expected)) {
    expect(decide(actors[who as Who], { action, target: organizationTarget }), who).toBe(decision);
  }
});

test("organization.readAuditLog: admins of the organization and platform admins; others hidden", () => {
  const expected = { platformAdmin: "allowed", organizationAdmin: "allowed", ...hiddenForOthers };
  for (const [who, decision] of Object.entries(expected)) {
    expect(
      decide(actors[who as Who], {
        action: "organization.readAuditLog",
        target: organizationTarget,
      }),
      who,
    ).toBe(decision);
  }
});

test.each(["platform.managePlatformAdmins", "platform.deleteAccounts"] as const)(
  "only a platform admin: %s; for others it is forbidden, not hidden",
  (action) => {
    for (const [who, a] of Object.entries(actors)) {
      expect(decide(a, { action }), who).toBe(who === "platformAdmin" ? "allowed" : "forbidden");
    }
  },
);

test("only a platform admin manages organizations", () => {
  for (const [who, a] of Object.entries(actors)) {
    expect(decide(a, { action: "platform.manageOrganizations" }), who).toBe(
      who === "platformAdmin" ? "allowed" : "forbidden",
    );
  }
});

test.each(["workingGroup.manage", "workingGroup.setCoordinator"] as const)("%s", (action) => {
  const expected = {
    platformAdmin: "allowed",
    organizationAdmin: "allowed",
    coordinator: "forbidden",
    volunteer: "forbidden",
    volunteerOtherGroup: "hidden",
    coordinatorOtherOrganization: "hidden",
    adminOtherOrganization: "hidden",
    applicant: "hidden",
  };
  for (const [who, decision] of Object.entries(expected)) {
    expect(decide(actors[who as Who], { action, target }), who).toBe(decision);
  }
});

test("a member of a working group is an outsider to its organization", () => {
  expect(organizationRelationTo(actors.platformAdmin, organizationTarget)).toBe("platformAdmin");
  expect(organizationRelationTo(actors.organizationAdmin, organizationTarget)).toBe(
    "organizationAdmin",
  );
  expect(organizationRelationTo(actors.coordinator, organizationTarget)).toBe("outsider");
  expect(organizationRelationTo(actors.volunteer, organizationTarget)).toBe("outsider");
  expect(organizationRelationTo(actors.adminOtherOrganization, organizationTarget)).toBe(
    "outsider",
  );
});
