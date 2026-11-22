import type { GetMeResponse } from "./generated";

export type GateState = "login" | "name" | "app";

/** What a logged-in or logged-out visitor sees first. Shared by the mobile app and the portal. */
export function gateState(me: GetMeResponse | null): GateState {
  if (me === null) return "login";
  if (me.user.name === "") return "name";
  return "app";
}
