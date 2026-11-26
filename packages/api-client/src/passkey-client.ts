import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type { PasskeyError, PasskeyResult } from "@padvinder/contracts";

export type { PasskeyError, PasskeyResult };

/** Whether this browser can make and use a passkey at all. */
export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/** A step that failed, with the reason the caller reports. */
class PasskeyFailure extends Error {
  constructor(readonly reason: PasskeyError) {
    super(reason);
  }
}

/**
 * The reason for a refused call. Our own refusals (`not_allowed`, `passkey_required`,
 * `too_many_passkeys`) and Better Auth's (`SESSION_NOT_FRESH` and the like) both carry a `code`;
 * a 429 without a known code is a rate limit.
 */
function serverError(status: number, code: unknown): PasskeyError {
  switch (code) {
    case "SESSION_NOT_FRESH":
      return "session_too_old";
    case "PASSKEY_OF_OTHER_ACCOUNT":
      return "other_account";
    case "PASSKEY_NOT_FOUND":
      return "unknown_passkey";
    case "not_allowed":
      return "not_allowed";
    case "passkey_required":
      return "confirmation_required";
    case "too_many_passkeys":
      return "too_many_passkeys";
    default:
      return status === 429 ? "too_busy" : "failed";
  }
}

/** The reason the browser's ceremony failed, as SimpleWebAuthn throws it. */
function browserError(error: unknown): PasskeyError {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown };
  // The person closed the dialog, or it timed out (both NotAllowedError), or it was aborted.
  if (name === "NotAllowedError" || code === "ERROR_CEREMONY_ABORTED") return "cancelled";
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "already_registered";
  return "failed";
}

/** `POST`s JSON to one of the passkey routes, on the page's own origin with its cookies. */
async function post(path: string, body: object): Promise<unknown> {
  const response = await fetch(`/api/auth/passkey/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const answer: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      answer !== null && typeof answer === "object"
        ? (answer as { code?: unknown }).code
        : undefined;
    throw new PasskeyFailure(serverError(response.status, code));
  }
  return answer;
}

/**
 * The two steps of a ceremony: the options from the server, the browser's dialog, and its answer
 * back to the server. Never throws.
 */
async function ceremony(
  kind: "register" | "authenticate",
  browserStep: (optionsJSON: unknown) => Promise<unknown>,
): Promise<PasskeyResult> {
  if (!passkeysSupported()) return { ok: false, error: "unsupported" };
  try {
    const optionsJSON = await post(`generate-${kind}-options`, {});
    let response: unknown;
    try {
      response = await browserStep(optionsJSON);
    } catch (error) {
      return { ok: false, error: browserError(error) };
    }
    const verify = kind === "register" ? "verify-registration" : "verify-authentication";
    await post(verify, { response });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof PasskeyFailure ? error.reason : "failed" };
  }
}

/**
 * Makes a passkey for the logged-in admin. The server answers with a new, confirmed session: the
 * old one is gone, so the caller refetches me and reopens the event stream.
 */
export function createPasskey(): Promise<PasskeyResult> {
  return ceremony("register", (optionsJSON) =>
    // The server's options, passed on as they came.
    startRegistration({ optionsJSON: optionsJSON as PublicKeyCredentialCreationOptionsJSON }),
  );
}

/**
 * Logs in with a passkey, or confirms the session of the logged-in admin. Like `createPasskey`,
 * a success replaces the session.
 */
export function authenticateWithPasskey(): Promise<PasskeyResult> {
  return ceremony("authenticate", (optionsJSON) =>
    startAuthentication({ optionsJSON: optionsJSON as PublicKeyCredentialRequestOptionsJSON }),
  );
}
