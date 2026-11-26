import type { TestApp } from "./login";

/**
 * Sets `passkey_verified_at` on the session whose token is in `cookie` (a `cookie` header value;
 * the signed cookie value is `token.signature`, URL-encoded). Tests only: nothing in the API's
 * entry points imports this file, so the release cannot reach it.
 */
export async function stampSession(ctx: TestApp, cookie: string, at: Date | null): Promise<void> {
  const pair = cookie.split(";").find((part) => part.trim().includes("session_token="));
  if (!pair) throw new Error("No session cookie to stamp");
  const value = decodeURIComponent(pair.slice(pair.indexOf("=") + 1).trim());
  const token = value.slice(0, value.lastIndexOf("."));
  const res = await ctx.t.pool.query(
    "update sessions set passkey_verified_at = $1 where token = $2",
    [at, token],
  );
  if (res.rowCount !== 1) throw new Error("No session found for the cookie");
}
