import { apiErrorCodes } from "@padvinder/contracts";
import { apiError } from "../errors";
import type { Actor } from "./actor";

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

/** `hidden` is answered as 404, `forbidden` as 403. */
export type Decision = "allowed" | "forbidden" | "hidden";

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

export function decide(actor: Actor, permission: Permission): Decision {
  // Platform-wide: no target, and never `hidden` (the species list is not secret).
  if (
    permission.action === "system.viewDatabaseDetails" ||
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

export function authorize(actor: Actor, permission: Permission): void {
  const decision = decide(actor, permission);
  if (decision === "hidden") throw apiError(404, apiErrorCodes.notFound, "Not found");
  if (decision === "forbidden") throw apiError(403, apiErrorCodes.notAllowed, "Not allowed");
}
