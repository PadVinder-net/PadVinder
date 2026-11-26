import { expect, test } from "vitest";
import type { Actor } from "./actor";
import {
  authorize,
  decide,
  organizationRelationTo,
  type Permission,
  relationTo,
  requiredConfirmation,
} from "./rules";

function m(workingGroupId: string, organizationId: string, as: "volunteer" | "coordinator") {
  const isCoordinator = as === "coordinator";
  return { membershipId: `m-${workingGroupId}`, workingGroupId, organizationId, isCoordinator };
}

const NOW = new Date("2026-11-26T12:00:00Z");

function actor(parts: Partial<Omit<Actor, "userId" | "user">>): Actor {
  return {
    userId: "u-1",
    user: { id: "u-1", name: "Test", email: "test@example.test", phone: null },
    // Recently confirmed by default, so the role tables below read as roles alone.
    passkeyVerifiedAt: new Date(NOW.getTime() - 60 * 1000),
    now: NOW,
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

test.each([
  "platform.managePlatformAdmins",
  "platform.listPlatformAdmins",
  "platform.deleteAccounts",
  "platform.lookUpAccounts",
] as const)("only a platform admin: %s; for others it is forbidden, not hidden", (action) => {
  for (const [who, a] of Object.entries(actors)) {
    expect(decide(a, { action }), who).toBe(who === "platformAdmin" ? "allowed" : "forbidden");
  }
});

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

const confirmedAt = {
  recent: new Date(NOW.getTime() - 60 * 1000),
  confirmed: new Date(NOW.getTime() - 60 * 60 * 1000),
  none: null,
};
const withConfirmation = (a: Actor, c: keyof typeof confirmedAt): Actor => ({
  ...a,
  passkeyVerifiedAt: confirmedAt[c],
});

const newActions = [
  "admin.listAdministered",
  "passkeys.listOwn",
  "passkeys.removeOwn",
  "passkeys.add",
  "organization.resetAdminPasskeys",
  "platform.resetPlatformAdminPasskeys",
] as const;

// One permission per existing action; a new action outside `newActions` is a type error here.
const existingPermissions = {
  "system.viewDatabaseDetails": { action: "system.viewDatabaseDetails" },
  "platform.manageSpecies": { action: "platform.manageSpecies" },
  "platform.manageOrganizations": { action: "platform.manageOrganizations" },
  "platform.managePlatformAdmins": { action: "platform.managePlatformAdmins" },
  "platform.deleteAccounts": { action: "platform.deleteAccounts" },
  "platform.listPlatformAdmins": { action: "platform.listPlatformAdmins" },
  "platform.lookUpAccounts": { action: "platform.lookUpAccounts" },
  "organization.view": { action: "organization.view", target: organizationTarget },
  "organization.readAuditLog": { action: "organization.readAuditLog", target: organizationTarget },
  "organization.changeContact": {
    action: "organization.changeContact",
    target: organizationTarget,
  },
  "organization.rename": { action: "organization.rename", target: organizationTarget },
  "organization.manageAdmins": { action: "organization.manageAdmins", target: organizationTarget },
  "organization.createWorkingGroup": {
    action: "organization.createWorkingGroup",
    target: organizationTarget,
  },
  "workingGroup.manage": { action: "workingGroup.manage", target },
  "workingGroup.setCoordinator": { action: "workingGroup.setCoordinator", target },
  "workingGroup.listMembers": { action: "workingGroup.listMembers", target },
  "workingGroup.viewMemberContact": { action: "workingGroup.viewMemberContact", target },
  "workingGroup.reviewRequests": { action: "workingGroup.reviewRequests", target },
  "workingGroup.addMembers": { action: "workingGroup.addMembers", target },
  "system.triggerTestError": { action: "system.triggerTestError" },
  "workingGroup.removeMember": {
    action: "workingGroup.removeMember",
    target,
    memberIsCoordinator: false,
  },
} satisfies Record<Exclude<Permission["action"], (typeof newActions)[number]>, Permission>;

const adminActions = Object.values(existingPermissions) as Permission[];

test("every existing admin action is confirm without a confirmation and allowed with one", () => {
  for (const permission of adminActions) {
    for (const who of ["platformAdmin", "organizationAdmin"] as const) {
      // Platform-only actions are forbidden for an organization admin, whatever the session.
      const full = decide(withConfirmation(actors[who], "recent"), permission);
      if (full !== "allowed") {
        expect(decide(withConfirmation(actors[who], "none"), permission)).toBe(full);
        continue;
      }
      const label = `${permission.action} ${who}`;
      expect(decide(withConfirmation(actors[who], "none"), permission), label).toBe("confirm");
      expect(decide(withConfirmation(actors[who], "confirmed"), permission), label).toBe(
        requiredConfirmation(permission) === "recent" ? "confirm" : "allowed",
      );
    }
  }
});

const orgAdminWhoCoordinates = (c: keyof typeof confirmedAt) =>
  withConfirmation(
    actor({
      adminOfOrganizationIds: ["o-a"],
      memberships: [m("g-a1", "o-a", "coordinator"), m("g-a2", "o-a", "volunteer")],
    }),
    c,
  );

test("an organization admin who coordinates the group keeps reviewRequests, viewMemberContact, addMembers and removeMember of a volunteer without a confirmation", () => {
  const a = orgAdminWhoCoordinates("none");
  for (const action of [
    "workingGroup.reviewRequests",
    "workingGroup.viewMemberContact",
    "workingGroup.addMembers",
  ] as const) {
    expect(decide(a, { action, target }), action).toBe("allowed");
  }
  expect(
    decide(a, { action: "workingGroup.removeMember", target, memberIsCoordinator: false }),
  ).toBe("allowed");
  // Removing a coordinator, and managing the group, are admin power.
  expect(
    decide(a, { action: "workingGroup.removeMember", target, memberIsCoordinator: true }),
  ).toBe("confirm");
  expect(decide(a, { action: "workingGroup.manage", target })).toBe("confirm");
});

test("an organization admin who is a volunteer of the group: listMembers allowed, viewMemberContact confirm", () => {
  const a = withConfirmation(
    actor({ adminOfOrganizationIds: ["o-a"], memberships: [m("g-a1", "o-a", "volunteer")] }),
    "none",
  );
  expect(decide(a, { action: "workingGroup.listMembers", target })).toBe("allowed");
  expect(decide(a, { action: "workingGroup.viewMemberContact", target })).toBe("confirm");
});

test("an organization admin of another organization stays hidden, confirmed or not", () => {
  for (const c of ["recent", "confirmed", "none"] as const) {
    const a = withConfirmation(actors.adminOtherOrganization, c);
    for (const permission of adminActions) {
      if (permission.action.startsWith("platform.") || permission.action.startsWith("system.")) {
        continue;
      }
      expect(decide(a, permission), `${permission.action} ${c}`).toBe("hidden");
    }
  }
});

test("a platform admin who is a member of nothing: every working group action is confirm unconfirmed", () => {
  const a = withConfirmation(actors.platformAdmin, "none");
  for (const permission of adminActions.filter((p) => p.action.startsWith("workingGroup."))) {
    expect(decide(a, permission), permission.action).toBe("confirm");
  }
});

test.each([
  "platform.deleteAccounts",
  "platform.managePlatformAdmins",
  "organization.manageAdmins",
  "platform.manageOrganizations",
] as const)("%s needs the 10 minutes: confirm at 11 minutes, allowed at 9", (action) => {
  const permission = existingPermissions[action];
  const at = (minutes: number) => ({
    ...actors.platformAdmin,
    passkeyVerifiedAt: new Date(NOW.getTime() - minutes * 60 * 1000),
  });
  expect(decide(at(11), permission)).toBe("confirm");
  expect(decide(at(9), permission)).toBe("allowed");
});

test("platform.listPlatformAdmins and platform.lookUpAccounts need 24 hours, not 10 minutes", () => {
  for (const action of ["platform.listPlatformAdmins", "platform.lookUpAccounts"] as const) {
    const at = (hours: number) => ({
      ...actors.platformAdmin,
      passkeyVerifiedAt: new Date(NOW.getTime() - hours * 60 * 60 * 1000),
    });
    expect(decide(at(1), { action })).toBe("allowed");
    expect(decide(at(25), { action })).toBe("confirm");
    expect(decide(actors.organizationAdmin, { action })).toBe("forbidden");
  }
});

test("admin.listAdministered: allowed for a coordinator and a volunteer, confirm for an unconfirmed admin who also coordinates", () => {
  const permission: Permission = { action: "admin.listAdministered" };
  expect(decide(withConfirmation(actors.coordinator, "none"), permission)).toBe("allowed");
  expect(decide(withConfirmation(actors.volunteer, "none"), permission)).toBe("allowed");
  expect(decide(withConfirmation(actors.applicant, "none"), permission)).toBe("allowed");
  expect(decide(orgAdminWhoCoordinates("none"), permission)).toBe("confirm");
  expect(decide(orgAdminWhoCoordinates("confirmed"), permission)).toBe("allowed");
  expect(decide(withConfirmation(actors.platformAdmin, "none"), permission)).toBe("confirm");
});

test("a volunteer, a coordinator and an applicant decide exactly as the roles alone, whatever their session", () => {
  for (const who of ["volunteer", "coordinator", "applicant", "volunteerOtherGroup"] as const) {
    const reference = decide(withConfirmation(actors[who], "recent"), {
      action: "passkeys.listOwn",
    });
    expect(reference).toBe("forbidden");
    for (const permission of Object.values(existingPermissions) as Permission[]) {
      const outcomes = (["recent", "confirmed", "none"] as const).map((c) =>
        decide(withConfirmation(actors[who], c), permission),
      );
      expect(new Set(outcomes).size, `${who} ${permission.action}`).toBe(1);
      expect(outcomes[0]).not.toBe("confirm");
    }
  }
});

test("the windows at their edges", () => {
  const edge = (ms: number) => ({
    ...actors.platformAdmin,
    passkeyVerifiedAt: new Date(NOW.getTime() - ms),
  });
  const day = 24 * 60 * 60 * 1000;
  const ten = 10 * 60 * 1000;
  expect(decide(edge(day - 1), { action: "platform.manageSpecies" })).toBe("allowed");
  expect(decide(edge(day), { action: "platform.manageSpecies" })).toBe("confirm");
  expect(decide(edge(ten - 1), { action: "platform.deleteAccounts" })).toBe("allowed");
  expect(decide(edge(ten), { action: "platform.deleteAccounts" })).toBe("confirm");
});

test.each([
  ["passkeys.listOwn", "confirmed"],
  ["passkeys.removeOwn", "recent"],
  ["platform.resetPlatformAdminPasskeys", "recent"],
] as const)("%s: per the table, and confirm outside its window", (action, window) => {
  const permission = { action } as Permission;
  const isPlatformOnly = action === "platform.resetPlatformAdminPasskeys";
  const states = ["recent", "confirmed", "none"] as const;
  for (const c of states) {
    const expectedAdmin =
      window === "recent" && c !== "recent" ? "confirm" : c === "none" ? "confirm" : "allowed";
    expect(
      decide(withConfirmation(actors.platformAdmin, c), permission),
      `platformAdmin ${c}`,
    ).toBe(expectedAdmin);
    expect(decide(withConfirmation(actors.organizationAdmin, c), permission)).toBe(
      isPlatformOnly ? "forbidden" : expectedAdmin,
    );
    for (const who of ["coordinator", "volunteer", "applicant"] as const) {
      expect(decide(withConfirmation(actors[who], c), permission), who).toBe("forbidden");
    }
  }
});

test("passkeys.add: allowed without a passkey from any session; with one, confirm unless recently confirmed; forbidden without an admin role", () => {
  for (const c of ["recent", "confirmed", "none"] as const) {
    for (const who of ["platformAdmin", "organizationAdmin"] as const) {
      expect(
        decide(withConfirmation(actors[who], c), { action: "passkeys.add", hasPasskey: false }),
      ).toBe("allowed");
      expect(
        decide(withConfirmation(actors[who], c), { action: "passkeys.add", hasPasskey: true }),
      ).toBe(c === "recent" ? "allowed" : "confirm");
    }
    for (const hasPasskey of [false, true]) {
      expect(
        decide(withConfirmation(actors.coordinator, c), { action: "passkeys.add", hasPasskey }),
      ).toBe("forbidden");
    }
  }
});

test("organization.resetAdminPasskeys: an admin of another organization and a coordinator of its group get hidden; an organization admin gets forbidden for a platform admin", () => {
  const reset = (subjectIsPlatformAdmin: boolean): Permission => ({
    action: "organization.resetAdminPasskeys",
    target: organizationTarget,
    subjectIsPlatformAdmin,
  });
  const recent = (who: Who) => withConfirmation(actors[who], "recent");
  expect(decide(recent("platformAdmin"), reset(true))).toBe("allowed");
  expect(decide(recent("platformAdmin"), reset(false))).toBe("allowed");
  expect(decide(recent("organizationAdmin"), reset(false))).toBe("allowed");
  expect(decide(recent("organizationAdmin"), reset(true))).toBe("forbidden");
  expect(decide(withConfirmation(actors.organizationAdmin, "confirmed"), reset(false))).toBe(
    "confirm",
  );
  expect(decide(withConfirmation(actors.platformAdmin, "none"), reset(false))).toBe("confirm");
  for (const who of ["adminOtherOrganization", "coordinator", "volunteer", "applicant"] as const) {
    expect(decide(recent(who), reset(false)), who).toBe("hidden");
  }
});

test("authorize throws 403 passkey_required for confirm", () => {
  expect(() =>
    authorize(withConfirmation(actors.platformAdmin, "none"), { action: "passkeys.listOwn" }),
  ).toThrowError(expect.objectContaining({ statusCode: 403, code: "passkey_required" }));
  expect(() =>
    authorize(withConfirmation(actors.platformAdmin, "recent"), { action: "passkeys.listOwn" }),
  ).not.toThrow();
});
