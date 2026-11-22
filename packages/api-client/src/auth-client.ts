import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";
import type { LoginError, LoginResult } from "@padvinder/contracts";

export type { LoginError, LoginResult };

let authClient: ReturnType<typeof createClient> | undefined;

function createClient() {
  return createAuthClient({
    baseURL: globalThis.location?.origin ?? "http://localhost",
    basePath: "/api/auth",
    plugins: [emailOTPClient()],
    // Look `fetch` up per call: the client would otherwise keep the one it finds at creation.
    fetchOptions: { customFetchImpl: (input, init) => globalThis.fetch(input, init) },
  });
}

/**
 * Created on first use. The API serves only three Better Auth routes and not `get-session`, so
 * nothing here may call `getSession` or `useSession`. Without those, the client never asks for the
 * session by itself (checked by a test); who is logged in comes from `GET /api/me`.
 */
function getAuthClient() {
  return (authClient ??= createClient());
}

type AuthFailure = { status?: number; code?: string } | null | undefined;

/**
 * Error codes as the API sends them (see apps/api/src/auth/login.test.ts). A 429 with one of our
 * own codes is the limit per address; a 429 without one is Better Auth's limit per IP address.
 */
function toLoginError(failure: AuthFailure): LoginError {
  switch (failure?.code) {
    case "INVALID_EMAIL":
      return "invalid_email";
    case "INVALID_OTP":
      return "wrong_code";
    case "OTP_EXPIRED":
      return "code_expired";
    case "TOO_MANY_ATTEMPTS":
      return "too_many_attempts";
    case "TOO_MANY_LOGIN_CODES":
      return "too_many_codes";
    case "TOO_MANY_LOGIN_CODES_TODAY":
      return "too_many_codes_today";
    default:
      return failure?.status === 429 ? "too_busy" : "failed";
  }
}

async function attempt(call: () => Promise<{ error: AuthFailure }>): Promise<LoginResult> {
  try {
    const { error } = await call();
    return error ? { ok: false, error: toLoginError(error) } : { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** Mails a login code. Never throws. */
export function requestLoginCode(email: string): Promise<LoginResult> {
  return attempt(() => getAuthClient().emailOtp.sendVerificationOtp({ email, type: "sign-in" }));
}

/** Logs in with the code from the mail; the API sets the session cookie. Never throws. */
export function logInWithCode(email: string, code: string): Promise<LoginResult> {
  return attempt(() => getAuthClient().signIn.emailOtp({ email, otp: code }));
}

/**
 * Ends the session. Never throws. On `{ ok: false }` the session cookie is probably still valid,
 * so the caller must not act as if the user is logged out.
 */
export function logOut(): Promise<LoginResult> {
  return attempt(() => getAuthClient().signOut());
}
