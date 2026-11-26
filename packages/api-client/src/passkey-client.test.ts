import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type { PasskeyError } from "@padvinder/contracts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { authenticateWithPasskey, createPasskey, passkeysSupported } from "./passkey-client";

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(),
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));

const registrationOptions = { challenge: "challenge-1", rp: { name: "PadVinder" } };
const authenticationOptions = { challenge: "challenge-2" };
const registrationResponse = { id: "credential-1", type: "public-key" };
const authenticationResponse = { id: "credential-2", type: "public-key" };

type Seen = { method: string; path: string; body: string; credentials?: RequestCredentials };
type Answer = Response | (() => Response);

/** Answers by "METHOD /path" and keeps what each request looked like. */
function stubFetch(routes: Record<string, Answer>) {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(new URL(String(input), "http://localhost"), init);
    const path = new URL(request.url).pathname;
    seen.push({
      method: request.method,
      path,
      body: await request.text(),
      credentials: init?.credentials,
    });
    const answer = routes[`${request.method} ${path}`];
    if (answer === undefined) throw new TypeError(`No mock for ${request.method} ${path}`);
    return typeof answer === "function" ? answer() : answer.clone();
  });
  return seen;
}

const ok = () => Response.json({ ok: true });
const ours = (status: number, code: string) =>
  Response.json({ statusCode: status, error: "x", message: "x", code }, { status });
const betterAuth = (status: number, code: string) =>
  Response.json({ code, message: "x" }, { status });

const registerRoutes = {
  "POST /api/auth/passkey/generate-register-options": Response.json(registrationOptions),
  "POST /api/auth/passkey/verify-registration": ok(),
};
const authenticateRoutes = {
  "POST /api/auth/passkey/generate-authenticate-options": Response.json(authenticationOptions),
  "POST /api/auth/passkey/verify-authentication": ok(),
};

beforeEach(() => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
  vi.mocked(startRegistration).mockResolvedValue(registrationResponse as never);
  vi.mocked(startAuthentication).mockResolvedValue(authenticationResponse as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

test("createPasskey posts to the generate route, then posts the browser's response to verify-registration", async () => {
  const seen = stubFetch(registerRoutes);
  expect(await createPasskey()).toEqual({ ok: true });
  expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
    "POST /api/auth/passkey/generate-register-options",
    "POST /api/auth/passkey/verify-registration",
  ]);
  expect(JSON.parse(seen[0]!.body)).toEqual({});
  expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: registrationOptions });
  expect(JSON.parse(seen[1]!.body)).toEqual({ response: registrationResponse });
  expect(seen.every((s) => s.credentials === "same-origin")).toBe(true);
});

test("authenticateWithPasskey posts to the generate route, then posts the browser's response to verify-authentication", async () => {
  const seen = stubFetch(authenticateRoutes);
  expect(await authenticateWithPasskey()).toEqual({ ok: true });
  expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
    "POST /api/auth/passkey/generate-authenticate-options",
    "POST /api/auth/passkey/verify-authentication",
  ]);
  expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: authenticationOptions });
  expect(JSON.parse(seen[1]!.body)).toEqual({ response: authenticationResponse });
});

test("the generate routes are called with POST, never GET", async () => {
  const seen = stubFetch({ ...registerRoutes, ...authenticateRoutes });
  await createPasskey();
  await authenticateWithPasskey();
  expect(seen.filter((s) => s.path.includes("/generate-")).map((s) => s.method)).toEqual([
    "POST",
    "POST",
  ]);
  expect(seen.some((s) => s.method === "GET")).toBe(false);
});

/** A failure of the browser's ceremony, as SimpleWebAuthn throws it. */
function browserError(name: string, code?: string): Error {
  return Object.assign(new Error("ceremony failed"), { name, ...(code && { code }) });
}

type Step = "generate" | "browser" | "verify";
type Case = [
  label: string,
  expected: PasskeyError,
  call: "create" | "authenticate",
  step: Step,
  failure: () => Response | Error,
];

const cases: Case[] = [
  [
    "NotAllowedError",
    "cancelled",
    "authenticate",
    "browser",
    () => browserError("NotAllowedError"),
  ],
  [
    "ERROR_CEREMONY_ABORTED",
    "cancelled",
    "create",
    "browser",
    () => browserError("AbortError", "ERROR_CEREMONY_ABORTED"),
  ],
  [
    "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
    "already_registered",
    "create",
    "browser",
    () => browserError("InvalidStateError", "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"),
  ],
  [
    "another browser error",
    "failed",
    "create",
    "browser",
    () => browserError("UnknownError", "ERROR_AUTHENTICATOR_GENERAL_ERROR"),
  ],
  [
    "SESSION_NOT_FRESH",
    "session_too_old",
    "create",
    "generate",
    () => betterAuth(403, "SESSION_NOT_FRESH"),
  ],
  [
    "PASSKEY_OF_OTHER_ACCOUNT",
    "other_account",
    "authenticate",
    "verify",
    () => betterAuth(401, "PASSKEY_OF_OTHER_ACCOUNT"),
  ],
  [
    "PASSKEY_NOT_FOUND",
    "unknown_passkey",
    "authenticate",
    "verify",
    () => betterAuth(401, "PASSKEY_NOT_FOUND"),
  ],
  [
    "CHALLENGE_NOT_FOUND",
    "failed",
    "authenticate",
    "verify",
    () => betterAuth(400, "CHALLENGE_NOT_FOUND"),
  ],
  [
    "AUTHENTICATION_FAILED",
    "failed",
    "authenticate",
    "verify",
    () => betterAuth(401, "AUTHENTICATION_FAILED"),
  ],
  ["not_allowed", "not_allowed", "create", "generate", () => ours(403, "not_allowed")],
  [
    "passkey_required",
    "confirmation_required",
    "create",
    "generate",
    () => ours(403, "passkey_required"),
  ],
  [
    "too_many_passkeys",
    "too_many_passkeys",
    "create",
    "verify",
    () => ours(409, "too_many_passkeys"),
  ],
  [
    "429 without a code",
    "too_busy",
    "authenticate",
    "generate",
    () => Response.json({ message: "Too many requests" }, { status: 429 }),
  ],
  ["a 500", "failed", "create", "verify", () => ours(500, "internal_error")],
  [
    "an answer that is not JSON",
    "failed",
    "create",
    "generate",
    () => new Response("<html>", { status: 502 }),
  ],
];

test.each(cases)("%s gives %s", async (_label, expected, call, step, failure) => {
  const prefix = call === "create" ? "register" : "authenticate";
  const verify = call === "create" ? "verify-registration" : "verify-authentication";
  const routes: Record<string, Answer> = {
    [`POST /api/auth/passkey/generate-${prefix}-options`]:
      step === "generate"
        ? (failure as () => Response)
        : Response.json(call === "create" ? registrationOptions : authenticationOptions),
    [`POST /api/auth/passkey/${verify}`]: step === "verify" ? (failure as () => Response) : ok(),
  };
  const seen = stubFetch(routes);
  if (step === "browser") {
    const start = call === "create" ? startRegistration : startAuthentication;
    vi.mocked(start).mockRejectedValue(failure());
  }
  const run = call === "create" ? createPasskey : authenticateWithPasskey;
  expect(await run()).toEqual({ ok: false, error: expected });
  // A failure stops the steps after it.
  if (step !== "verify") expect(seen.some((s) => s.path.endsWith(verify))).toBe(false);
});

test("a network failure gives failed and does not throw", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  expect(await createPasskey()).toEqual({ ok: false, error: "failed" });
  expect(await authenticateWithPasskey()).toEqual({ ok: false, error: "failed" });
});

test("without WebAuthn nothing is sent and the answer is unsupported", async () => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
  const seen = stubFetch({ ...registerRoutes, ...authenticateRoutes });
  expect(passkeysSupported()).toBe(false);
  expect(await createPasskey()).toEqual({ ok: false, error: "unsupported" });
  expect(await authenticateWithPasskey()).toEqual({ ok: false, error: "unsupported" });
  expect(seen).toEqual([]);
  expect(startRegistration).not.toHaveBeenCalled();
  expect(startAuthentication).not.toHaveBeenCalled();
});

test("passkeysSupported follows the browser", () => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
  expect(passkeysSupported()).toBe(true);
});
