import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { apiErrorCodes } from "@padvinder/contracts";
import { apiError } from "../errors";
import { forwardLog, type Auth } from "./auth";
import { toFetchHeaders } from "./fetch-headers";

/** The request as a Fetch `Request`, the form Better Auth's handler takes. */
function toFetchRequest(request: FastifyRequest, origin: string): Request {
  // The URL is built on our own origin, never on the Host header a client sends.
  const url = new URL(request.url, origin);
  // The body is serialized again below, so its length and encoding may differ.
  const headers = toFetchHeaders(request, ["content-length", "transfer-encoding"]);
  const hasBody = request.body !== undefined && request.body !== null;
  return new Request(url, {
    method: request.method,
    headers,
    ...(hasBody && { body: JSON.stringify(request.body) }),
  });
}

/**
 * The response body for the client, without the session token. Signing in answers
 * `{ token, user }`; the token is the secret the HttpOnly cookie keeps away from scripts on the
 * page, and the apps never use it.
 */
async function clientBody(response: Response): Promise<string | null> {
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
 * The only Better Auth endpoints the apps use (the design, "Login"): ask for a code, sign in
 * with it, sign out. Better Auth has many more (profile and password changes, session lists,
 * other kinds of codes); they bypass our contract, so they are not mounted and answer 404.
 */
export const AUTH_PATHS = [
  "/auth/email-otp/send-verification-otp",
  "/auth/sign-in/email-otp",
  "/auth/sign-out",
] as const;

/**
 * Better Auth's routes, mounted as its Fastify guide describes but per path instead of a
 * catch-all. They are the one exception to "Zod schemas are the API contract" and are hidden
 * from OpenAPI. Register with the prefix `/api`. The Origin hook on the root instance covers
 * them too.
 */
export const authRoutes: FastifyPluginAsync<{ auth: Auth; origin: string }> = async (
  api,
  { auth, origin },
) => {
  for (const url of AUTH_PATHS) {
    api.route({
      method: "POST",
      url,
      schema: { hide: true },
      async handler(request, reply) {
        let response: Response;
        try {
          response = await auth.handler(toFetchRequest(request, origin));
        } catch (error) {
          // Logged scrubbed: a database error can carry a row with an email address.
          forwardLog(request.log)("error", "Unexpected error", error);
          throw apiError(500, apiErrorCodes.internalError, "Internal server error");
        }
        reply.status(response.status);
        response.headers.forEach((value, name) => {
          // Set-Cookie is copied one by one below; Fastify sets the length itself (and the body
          // may be shorter, see `clientBody`).
          if (name === "set-cookie" || name === "content-length") return;
          reply.header(name, value);
        });
        // Several cookies at once (sign-out clears a few): each must reach the client.
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) reply.header("set-cookie", cookies);
        return reply.send(await clientBody(response));
      },
    });
  }
};
