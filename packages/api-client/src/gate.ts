import type { GetMeResponse } from "./generated";

/**
 * - `login`: not logged in;
 * - `name`: logged in, no name yet;
 * - `choose`: no membership, no admin role and no pending request ("Kies je werkgroep"; also after
 *   a rejection);
 * - `waiting`: a pending request and no membership or admin role ("Welkom!");
 * - `app`: a membership, an organization admin row or the platform admin flag.
 */
export type GateState = "login" | "name" | "choose" | "waiting" | "app";

/** What a logged-in or logged-out visitor sees first. Shared by the mobile app and the portal. */
export function gateState(me: GetMeResponse | null): GateState {
  if (me === null) return "login";
  if (me.user.name === "") return "name";
  if (me.memberships.length > 0 || me.organizationAdminOf.length > 0 || me.user.isPlatformAdmin)
    return "app";
  if (me.membershipRequest?.status === "pending") return "waiting";
  return "choose";
}

/**
 * True when the me query has failed and there is nothing to show instead. A failed background
 * refetch with a known state (a user, or `null`) keeps that state: a brief loss of signal must not
 * replace the app.
 */
export function meLoadFailed(me: { isError: boolean; data: unknown }): boolean {
  return me.isError && me.data === undefined;
}
