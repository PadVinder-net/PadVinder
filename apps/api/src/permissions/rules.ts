import { apiErrorCodes } from "@padvinder/contracts";
import type { MembershipRole } from "@padvinder/db";
import { apiError } from "../errors";
import type { Actor } from "./actor";

/**
 * The permission rules, as pure functions. Routes never compare roles themselves: they call
 * `authorize` (or `decide`) with what they want to do.
 */

export type WorkingGroupTarget = { workingGroupId: string; organizationId: string };

export type Relation =
  | "platformAdmin"
  | "organizationAdmin"
  | "coordinator"
  | "volunteer"
  | "outsider";

export type Permission =
  | { action: "system.viewDatabaseDetails" }
  | { action: "workingGroup.listMembers"; target: WorkingGroupTarget }
  | { action: "workingGroup.viewMemberContact"; target: WorkingGroupTarget }
  | { action: "workingGroup.reviewRequests"; target: WorkingGroupTarget }
  | { action: "workingGroup.removeMember"; target: WorkingGroupTarget; memberRole: MembershipRole };

/** `hidden` is answered as 404, `forbidden` as 403. */
export type Decision = "allowed" | "forbidden" | "hidden";

/** The strongest relation the actor has to a working group. */
export function relationTo(actor: Actor, target: WorkingGroupTarget): Relation {
  if (actor.isPlatformAdmin) return "platformAdmin";
  if (actor.adminOfOrganizationIds.includes(target.organizationId)) return "organizationAdmin";
  const membership = actor.memberships.find(
    (m) => m.workingGroupId === target.workingGroupId && m.organizationId === target.organizationId,
  );
  return membership?.role ?? "outsider";
}

const staff: readonly Relation[] = ["platformAdmin", "organizationAdmin", "coordinator"];

export function decide(actor: Actor, permission: Permission): Decision {
  if (permission.action === "system.viewDatabaseDetails") {
    return actor.isPlatformAdmin ? "allowed" : "forbidden";
  }
  const relation = relationTo(actor, permission.target);
  if (relation === "outsider") return "hidden";
  switch (permission.action) {
    case "workingGroup.listMembers":
      return "allowed";
    case "workingGroup.viewMemberContact":
    case "workingGroup.reviewRequests":
      return staff.includes(relation) ? "allowed" : "forbidden";
    case "workingGroup.removeMember":
      if (relation === "coordinator") {
        return permission.memberRole === "volunteer" ? "allowed" : "forbidden";
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
