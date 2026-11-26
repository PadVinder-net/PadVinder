import type { FastifyReply } from "fastify";

/**
 * The response body for the client, without the session token. Signing in answers
 * `{ token, user }`; the token is the secret the HttpOnly cookie keeps away from scripts on the
 * page, and the apps never use it.
 */
export async function clientBody(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const text = await response.text();
  if (!response.headers.get("content-type")?.includes("application/json")) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (parsed === null || typeof parsed !== "object" || !("token" in parsed)) return text;
  const { token: _token, ...rest } = parsed;
  return JSON.stringify(rest);
}

/**
 * Copies the cookies of Better Auth's response, each one: sign-out clears a few. When a cookie is
 * set twice (a session renewed and then replaced in one call), only the last one goes out, as a
 * browser would keep it.
 */
export function copyCookies(reply: FastifyReply, response: Response): void {
  const byName = new Map<string, string>();
  for (const cookie of response.headers.getSetCookie()) {
    byName.set(cookie.slice(0, cookie.indexOf("=")), cookie);
  }
  if (byName.size > 0) void reply.header("set-cookie", [...byName.values()]);
}

/** Answers Better Auth's response as it is, with `body` (see `clientBody`). */
export function sendAuthResponse(
  reply: FastifyReply,
  response: Response,
  body: string | null,
): FastifyReply {
  reply.status(response.status);
  response.headers.forEach((value, name) => {
    // Set-Cookie is copied one by one; Fastify sets the length itself (and the body may be
    // shorter, see `clientBody`).
    if (name === "set-cookie" || name === "content-length") return;
    void reply.header(name, value);
  });
  copyCookies(reply, response);
  return reply.send(body);
}
