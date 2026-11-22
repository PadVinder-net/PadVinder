import type { GetMeResponse } from "./generated";

export type GateState = "login" | "name" | "app";

/** What a logged-in or logged-out visitor sees first. Shared by the mobile app and the portal. */
export function gateState(me: GetMeResponse | null): GateState {
  if (me === null) return "login";
  if (me.user.name === "") return "name";
  return "app";
}

/**
 * True when the me query has failed and there is nothing to show instead. A failed background
 * refetch with a known state (a user, or `null`) keeps that state: a brief loss of signal must not
 * replace the app.
 */
export function meLoadFailed(me: { isError: boolean; data: unknown }): boolean {
  return me.isError && me.data === undefined;
}
