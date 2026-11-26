import type { Actor } from "./actor";

/** Confirmed for 24 hours after the last passkey, measured from `passkeyVerifiedAt`. */
export const ADMIN_PASSKEY_CONFIRMATION_WINDOW = 24 * 60 * 60 * 1000;
/** Recently confirmed: the first 10 minutes. */
export const ADMIN_PASSKEY_RECENT_CONFIRMATION_WINDOW = 10 * 60 * 1000;

export type Confirmation = "recent" | "confirmed" | "none";

/** How well a passkey confirmed the actor's session at `actor.now`; never extended by use. */
export function confirmationOf(actor: Pick<Actor, "passkeyVerifiedAt" | "now">): Confirmation {
  if (!actor.passkeyVerifiedAt) return "none";
  const age = actor.now.getTime() - actor.passkeyVerifiedAt.getTime();
  if (age < 0) return "none";
  if (age < ADMIN_PASSKEY_RECENT_CONFIRMATION_WINDOW) return "recent";
  if (age < ADMIN_PASSKEY_CONFIRMATION_WINDOW) return "confirmed";
  return "none";
}

/** Whether the actor is a platform admin or an organization admin. */
export function hasAdminRole(
  actor: Pick<Actor, "isPlatformAdmin" | "adminOfOrganizationIds">,
): boolean {
  return actor.isPlatformAdmin || actor.adminOfOrganizationIds.length > 0;
}

/** Until when an admin's session counts as confirmed, or null (no admin role, or unconfirmed). */
export function adminConfirmedUntil(actor: Actor): Date | null {
  if (!hasAdminRole(actor) || confirmationOf(actor) === "none" || !actor.passkeyVerifiedAt) {
    return null;
  }
  return new Date(actor.passkeyVerifiedAt.getTime() + ADMIN_PASSKEY_CONFIRMATION_WINDOW);
}

/** The actor with the admin roles taken away, everything else kept. */
export function withoutAdminRoles(actor: Actor): Actor {
  return { ...actor, isPlatformAdmin: false, adminOfOrganizationIds: [] };
}

/**
 * The actor as the rules see them: an admin without a confirmation falls back to what they are
 * besides admin.
 */
export function effectiveActor(actor: Actor): Actor {
  return hasAdminRole(actor) && confirmationOf(actor) === "none" ? withoutAdminRoles(actor) : actor;
}
