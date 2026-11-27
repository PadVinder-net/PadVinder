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

/**
 * Why a passkey step failed, as the browser client in `@padvinder/api-client` reports it. The UI
 * picks its Dutch text from it. The passkey routes of Better Auth are not part of the OpenAPI
 * description, so this is not either.
 */
export const passkeyErrors = [
  "cancelled",
  "failed",
  "other_account",
  "session_too_old",
  "unsupported",
  "already_registered",
  "unknown_passkey",
  "not_allowed",
  "confirmation_required",
  "too_many_passkeys",
  "too_busy",
] as const;
export type PasskeyError = (typeof passkeyErrors)[number];

export type PasskeyResult = { ok: true } | { ok: false; error: PasskeyError };
