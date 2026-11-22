import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

export type LoginError =
  | "invalid_email"
  | "wrong_code"
  | "code_expired"
  | "too_many_attempts"
  | "too_many_codes"
  | "failed";

export type LoginResult = { ok: true } | { ok: false; error: LoginError };

const messages: Record<LoginError, string> = {
  invalid_email: "Vul een geldig e-mailadres in.",
  wrong_code: "Deze code klopt niet. Kijk nog eens in je mail.",
  code_expired: "Deze code is verlopen. Vraag een nieuwe code aan.",
  too_many_attempts: "Te veel pogingen. Vraag een nieuwe code aan.",
  too_many_codes: "Je hebt te vaak een code aangevraagd. Probeer het over een kwartier opnieuw.",
  failed: "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.",
};

export function loginErrorMessage(error: LoginError): string {
  return messages[error];
}

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

// Better Auth error codes, as the API sends them (see apps/api/src/auth/login.test.ts).
function toLoginError(failure: AuthFailure, onTooManyRequests: LoginError): LoginError {
  if (failure?.status === 429) return onTooManyRequests;
  switch (failure?.code) {
    case "INVALID_EMAIL":
      return "invalid_email";
    case "INVALID_OTP":
      return "wrong_code";
    case "OTP_EXPIRED":
      return "code_expired";
    case "TOO_MANY_ATTEMPTS":
      return "too_many_attempts";
    default:
      return "failed";
  }
}

async function attempt(
  call: () => Promise<{ error: AuthFailure }>,
  onTooManyRequests: LoginError,
): Promise<LoginResult> {
  try {
    const { error } = await call();
    return error ? { ok: false, error: toLoginError(error, onTooManyRequests) } : { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

/** Mails a login code. Never throws. */
export function requestLoginCode(email: string): Promise<LoginResult> {
  return attempt(
    () => getAuthClient().emailOtp.sendVerificationOtp({ email, type: "sign-in" }),
    "too_many_codes",
  );
}

/** Logs in with the code from the mail; the API sets the session cookie. Never throws. */
export function logInWithCode(email: string, code: string): Promise<LoginResult> {
  // A 429 here is the per-IP limit on checking codes.
  return attempt(() => getAuthClient().signIn.emailOtp({ email, otp: code }), "too_many_attempts");
}

/**
 * Ends the session. Never throws. On `{ ok: false }` the session cookie is probably still valid,
 * so the caller must not act as if the user is logged out.
 */
export function logOut(): Promise<LoginResult> {
  return attempt(() => getAuthClient().signOut(), "failed");
}
