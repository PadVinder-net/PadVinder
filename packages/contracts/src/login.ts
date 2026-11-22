/**
 * Why a login step failed, as the browser client in `@padvinder/api-client` reports it. The UI
 * picks its Dutch text from it (`loginErrorMessage` in `@padvinder/ui`). Logging in goes through
 * Better Auth's routes, not our own, so this is not part of the OpenAPI description.
 */
export const loginErrors = [
  "invalid_email",
  "wrong_code",
  "code_expired",
  "too_many_attempts",
  /** The limit per address per quarter of an hour. */
  "too_many_codes",
  /** The limit per address per 24 hours. */
  "too_many_codes_today",
  /** The limit per IP address: many people on one network at once. */
  "too_busy",
  "failed",
] as const;
export type LoginError = (typeof loginErrors)[number];

export type LoginResult = { ok: true } | { ok: false; error: LoginError };
