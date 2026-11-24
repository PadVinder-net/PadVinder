import { v7 } from "uuid";

/**
 * A new UUIDv7. AGENTS.md ("Data integrity"): the app makes the ID once, when the user acts, and
 * sends the same one on every resend. Call this at the moment of the tap, never while rendering.
 */
export function newId(): string {
  return v7();
}
