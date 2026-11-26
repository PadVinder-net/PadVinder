import type { LightMyRequestResponse } from "fastify";
import { testEnv } from "../test-env";
import type { TestApp } from "./login";
import type { SoftAuthenticator } from "./soft-authenticator";

/**
 * Sets `passkey_verified_at` on the session whose token is in `cookie` (a `cookie` header value;
 * the signed cookie value is `token.signature`, URL-encoded). Tests only: nothing in the API's
 * entry points imports this file, so the release cannot reach it.
 */
export async function stampSession(ctx: TestApp, cookie: string, at: Date | null): Promise<void> {
  const token = sessionTokenOf(cookie);
  if (!token) throw new Error("No session cookie to stamp");
  const res = await ctx.t.pool.query(
    "update sessions set passkey_verified_at = $1 where token = $2",
    [at, token],
  );
  if (res.rowCount !== 1) throw new Error("No session found for the cookie");
}

/** The session token in a `cookie` header value, or null when it holds no session cookie. */
export function sessionTokenOf(cookie: string | null): string | null {
  const pair = cookie?.split(";").find((part) => part.trim().includes("session_token="));
  if (!pair) return null;
  const value = decodeURIComponent(pair.slice(pair.indexOf("=") + 1).trim());
  return value.slice(0, value.lastIndexOf("."));
}

/**
 * `cookie` with the cookies `res` sets laid over it, as a browser keeps them: a later value
 * replaces an earlier one, an emptied or expired one is dropped. Null when nothing is left.
 */
export function withCookies(cookie: string | null, res: LightMyRequestResponse): string | null {
  const jar = new Map<string, string>();
  for (const part of cookie?.split(";") ?? []) {
    const index = part.indexOf("=");
    if (index > 0) jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  for (const set of res.cookies) {
    if (set.value === "" || set.maxAge === 0) jar.delete(set.name);
    else jar.set(set.name, set.value);
  }
  if (jar.size === 0) return null;
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** A `POST` to one of the auth routes, from the app's origin, as the apps send it. */
export function postAuth(
  ctx: TestApp,
  path: string,
  cookie: string | null,
  payload: object = {},
): Promise<LightMyRequestResponse> {
  return ctx.app.inject({
    method: "POST",
    url: `/api/auth${path}`,
    headers: { origin: testEnv.PUBLIC_ORIGIN, ...(cookie !== null && { cookie }) },
    payload,
  });
}

/**
 * Adds a passkey with the two registration calls. `cookie` is what the browser holds afterwards:
 * the new session's cookie when it worked. `response` is the last answer (the options' when they
 * were refused). `body` is sent along with the registration, to try what a client may not set.
 */
export async function addPasskey(
  ctx: TestApp,
  cookie: string,
  authenticator: SoftAuthenticator,
  body: Record<string, unknown> = {},
): Promise<{ cookie: string; response: LightMyRequestResponse }> {
  const options = await postAuth(ctx, "/passkey/generate-register-options", cookie);
  if (options.statusCode !== 200) return { cookie, response: options };
  const jar = withCookies(cookie, options) ?? cookie;
  const response = await postAuth(ctx, "/passkey/verify-registration", jar, {
    ...body,
    response: authenticator.register(options.json()),
  });
  return { cookie: withCookies(jar, response) ?? jar, response };
}

/** Uses a passkey with the two authentication calls: a login without `cookie`, a confirmation with one. */
export async function usePasskey(
  ctx: TestApp,
  cookie: string | null,
  authenticator: SoftAuthenticator,
): Promise<{ cookie: string | null; response: LightMyRequestResponse }> {
  const options = await postAuth(ctx, "/passkey/generate-authenticate-options", cookie);
  if (options.statusCode !== 200) return { cookie, response: options };
  const jar = withCookies(cookie, options);
  const response = await postAuth(ctx, "/passkey/verify-authentication", jar, {
    response: authenticator.authenticate(options.json()),
  });
  return { cookie: withCookies(jar, response), response };
}
