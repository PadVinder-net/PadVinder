import type { Decision } from "./rules";

/**
 * What a field that depends on a role does for this decision. `allowed` includes it; `confirm`
 * (the roles would allow it, only a passkey confirmation is missing) leaves it out and lets the
 * response name it in `passkeyReveals`; anything else leaves it out silently. Never a 403: a
 * field is not a reason to refuse the whole request.
 */
export function fieldAccess(decision: Decision): { include: boolean; reveal: boolean } {
  return { include: decision === "allowed", reveal: decision === "confirm" };
}
