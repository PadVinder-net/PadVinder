import type { LiveEvent, LiveEventAudience } from "@padvinder/contracts";
import type { Actor } from "../permissions/actor";
import { relationTo } from "../permissions/rules";

/** The IDs an event is addressed to. Which ones it needs depends on its audience. */
export type LiveEventAddress = {
  userId?: string;
  workingGroupId?: string;
  organizationId?: string;
};

/** The address fields an event carries, if they are strings. */
export function addressOf(event: LiveEvent): LiveEventAddress {
  const fields = event as Partial<Record<keyof LiveEventAddress, unknown>>;
  const address: LiveEventAddress = {};
  for (const key of ["userId", "workingGroupId", "organizationId"] as const) {
    const value = fields[key];
    if (typeof value === "string") address[key] = value;
  }
  return address;
}

/**
 * Whether a connection of `actor` receives an event for `audience` at `address`. An event for
 * `user` reaches only that user, platform admins included: it is personal. Platform admins
 * receive every other event, so the portal stays current in every organization. An address that
 * lacks the field its audience needs reaches platform admins only (nobody, for `user`), so a
 * mistake in an event never leaks it.
 */
export function shouldDeliver(
  actor: Actor,
  audience: LiveEventAudience,
  address: LiveEventAddress,
): boolean {
  if (audience === "user") return address.userId !== undefined && address.userId === actor.userId;
  if (actor.isPlatformAdmin) return true;
  switch (audience) {
    case "working-group-coordinators":
    case "working-group-members": {
      const { workingGroupId, organizationId } = address;
      if (workingGroupId === undefined || organizationId === undefined) return false;
      const relation = relationTo(actor, { workingGroupId, organizationId });
      return audience === "working-group-members"
        ? relation !== "outsider"
        : relation === "coordinator" || relation === "organizationAdmin";
    }
    case "organization": {
      const { organizationId } = address;
      if (organizationId === undefined) return false;
      return (
        actor.adminOfOrganizationIds.includes(organizationId) ||
        actor.memberships.some((m) => m.organizationId === organizationId)
      );
    }
    case "platform-admins":
      return false;
    default: {
      // A new audience without a rule is a type error here, never a silent delivery.
      const unreachable: never = audience;
      throw new Error(`No rule for audience ${String(unreachable)}`);
    }
  }
}
