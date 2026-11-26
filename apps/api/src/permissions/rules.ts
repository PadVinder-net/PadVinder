import { apiErrorCodes } from "@padvinder/contracts";
import { apiError } from "../errors";
import type { Actor } from "./actor";
import { confirmationOf, hasAdminRole } from "./confirmation";

/**
 * The permission rules, as pure functions. Routes never compare roles themselves: they call
 * `authorize` (or `decide`) with what they want to do.
 */

export type WorkingGroupTarget = { workingGroupId: string; organizationId: string };

export type OrganizationTarget = { organizationId: string };

export type Relation =
  | "platformAdmin"
  | "organizationAdmin"
  | "coordinator"
  | "volunteer"
  | "outsider";

export type Permission =
  | { action: "system.viewDatabaseDetails" }
  | { action: "system.triggerTestError" }
  | { action: "platform.manageSpecies" }
  | { action: "platform.manageOrganizations" }
  | { action: "platform.managePlatformAdmins" }
  | { action: "platform.deleteAccounts" }
  | { action: "organization.view"; target: OrganizationTarget }
  | { action: "organization.readAuditLog"; target: OrganizationTarget }
  | { action: "organization.changeContact"; target: OrganizationTarget }
  | { action: "organization.rename"; target: OrganizationTarget }
  | { action: "organization.manageAdmins"; target: OrganizationTarget }
  | { action: "organization.createWorkingGroup"; target: OrganizationTarget }
  | {
      action: "organization.resetAdminPasskeys";
      target: OrganizationTarget;
      subjectIsPlatformAdmin: boolean;
    }
  | { action: "platform.resetPlatformAdminPasskeys" }
  | { action: "passkeys.listOwn" }
  | { action: "passkeys.removeOwn" }
  | { action: "passkeys.add"; hasPasskey: boolean }
  | { action: "workingGroup.manage"; target: WorkingGroupTarget }
  | { action: "workingGroup.setCoordinator"; target: WorkingGroupTarget }
  | { action: "workingGroup.listMembers"; target: WorkingGroupTarget }
  | { action: "workingGroup.viewMemberContact"; target: WorkingGroupTarget }
  | { action: "workingGroup.reviewRequests"; target: WorkingGroupTarget }
  | { action: "workingGroup.addMembers"; target: WorkingGroupTarget }
  | {
      action: "workingGroup.removeMember";
      target: WorkingGroupTarget;
      memberIsCoordinator: boolean;
    };

/**
 * `hidden` is answered as 404, `forbidden` as 403 `not_allowed`, `confirm` as 403
 * `passkey_required`: the roles allow it, only a passkey confirmation is missing.
 */
export type Decision = "allowed" | "forbidden" | "hidden" | "confirm";

/**
 * The confirmation an action needs: `recent` (10 minutes), `confirmed` (24 hours) or none. An
 * exhaustive switch, so a new permission must say. Only asked once the roles allow the action.
 */
export function requiredConfirmation(permission: Permission): "none" | "confirmed" | "recent" {
  switch (permission.action) {
    case "passkeys.listOwn":
      return "confirmed";
    case "passkeys.removeOwn":
    case "organization.resetAdminPasskeys":
    case "platform.resetPlatformAdminPasskeys":
      return "recent";
    case "passkeys.add":
      return permission.hasPasskey ? "recent" : "none";
    case "system.viewDatabaseDetails":
    case "platform.manageSpecies":
    case "platform.manageOrganizations":
    case "platform.managePlatformAdmins":
    case "platform.deleteAccounts":
    case "organization.view":
    case "organization.readAuditLog":
    case "organization.changeContact":
    case "organization.rename":
    case "organization.manageAdmins":
    case "organization.createWorkingGroup":
    case "workingGroup.manage":
    case "workingGroup.setCoordinator":
    case "workingGroup.listMembers":
    case "workingGroup.viewMemberContact":
    case "workingGroup.reviewRequests":
    case "workingGroup.addMembers":
    case "workingGroup.removeMember":
      return "none";
    default: {
      const unreachable: never = permission;
      throw new Error(`No confirmation rule for ${JSON.stringify(unreachable)}`);
    }
  }
}

/** The strongest relation the actor has to a working group. */
export function relationTo(actor: Actor, target: WorkingGroupTarget): Relation {
  if (actor.isPlatformAdmin) return "platformAdmin";
  if (actor.adminOfOrganizationIds.includes(target.organizationId)) return "organizationAdmin";
  const membership = actor.memberships.find(
    (m) => m.workingGroupId === target.workingGroupId && m.organizationId === target.organizationId,
  );
  if (!membership) return "outsider";
  return membership.isCoordinator ? "coordinator" : "volunteer";
}

/** The actor's relation to an organization. Members of its working groups are outsiders to it. */
export function organizationRelationTo(
  actor: Actor,
  target: OrganizationTarget,
): "platformAdmin" | "organizationAdmin" | "outsider" {
  if (actor.isPlatformAdmin) return "platformAdmin";
  if (actor.adminOfOrganizationIds.includes(target.organizationId)) return "organizationAdmin";
  return "outsider";
}

const staff: readonly Relation[] = ["platformAdmin", "organizationAdmin", "coordinator"];

/** By role alone, before any confirmation window. */
function decideByRole(actor: Actor, permission: Permission): Exclude<Decision, "confirm"> {
  switch (permission.action) {
    case "passkeys.listOwn":
    case "passkeys.removeOwn":
    case "passkeys.add":
      return hasAdminRole(actor) ? "allowed" : "forbidden";
    case "platform.resetPlatformAdminPasskeys":
      return actor.isPlatformAdmin ? "allowed" : "forbidden";
    case "organization.resetAdminPasskeys": {
      const relation = organizationRelationTo(actor, permission.target);
      if (relation === "outsider") return "hidden";
      if (relation === "platformAdmin") return "allowed";
      return permission.subjectIsPlatformAdmin ? "forbidden" : "allowed";
    }
    default:
      break;
  }
  // Platform-wide: no target, and never `hidden` (the species list is not secret).
  if (
    permission.action === "system.viewDatabaseDetails" ||
    permission.action === "system.triggerTestError" ||
    permission.action === "platform.manageSpecies" ||
    permission.action === "platform.manageOrganizations" ||
    permission.action === "platform.managePlatformAdmins" ||
    permission.action === "platform.deleteAccounts"
  ) {
    return actor.isPlatformAdmin ? "allowed" : "forbidden";
  }
  switch (permission.action) {
    case "organization.view":
    case "organization.readAuditLog":
    case "organization.changeContact":
    case "organization.createWorkingGroup":
    case "organization.rename":
    case "organization.manageAdmins": {
      const relation = organizationRelationTo(actor, permission.target);
      if (relation === "outsider") return "hidden";
      if (relation === "platformAdmin") return "allowed";
      switch (permission.action) {
        case "organization.view":
        case "organization.readAuditLog":
        case "organization.changeContact":
        case "organization.createWorkingGroup":
          return "allowed";
        case "organization.rename":
        case "organization.manageAdmins":
          return "forbidden";
        default: {
          // A new organization action without a rule is a type error here, never a silent "allowed".
          const unreachable: never = permission;
          throw new Error(`No rule for ${JSON.stringify(unreachable)}`);
        }
      }
    }
    default:
      break;
  }
  const relation = relationTo(actor, permission.target);
  if (relation === "outsider") return "hidden";
  switch (permission.action) {
    case "workingGroup.listMembers":
      return "allowed";
    case "workingGroup.manage":
    case "workingGroup.setCoordinator":
      return relation === "platformAdmin" || relation === "organizationAdmin"
        ? "allowed"
        : "forbidden";
    case "workingGroup.viewMemberContact":
    case "workingGroup.reviewRequests":
    case "workingGroup.addMembers":
      return staff.includes(relation) ? "allowed" : "forbidden";
    case "workingGroup.removeMember":
      if (relation === "coordinator") {
        return permission.memberIsCoordinator ? "forbidden" : "allowed";
      }
      return staff.includes(relation) ? "allowed" : "forbidden";
    default: {
      // Adding a Permission without a rule is a type error here, never a silent "allowed".
      const unreachable: never = permission;
      throw new Error(`No rule for ${JSON.stringify(unreachable)}`);
    }
  }
}

export function decide(actor: Actor, permission: Permission): Decision {
  const byRole = decideByRole(actor, permission);
  if (byRole !== "allowed") return byRole;
  const needed = requiredConfirmation(permission);
  if (needed === "none") return "allowed";
  const confirmation = confirmationOf(actor);
  if (needed === "recent") return confirmation === "recent" ? "allowed" : "confirm";
  return confirmation === "none" ? "confirm" : "allowed";
}

export function authorize(actor: Actor, permission: Permission): void {
  const decision = decide(actor, permission);
  if (decision === "hidden") throw apiError(404, apiErrorCodes.notFound, "Not found");
  if (decision === "forbidden") throw apiError(403, apiErrorCodes.notAllowed, "Not allowed");
  if (decision === "confirm") {
    throw apiError(403, apiErrorCodes.passkeyRequired, "Confirm with a passkey first");
  }
}
