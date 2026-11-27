import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { apiErrorCodes } from "@padvinder/contracts";
import type { Db, QueueMail } from "@padvinder/db";
import { apiError } from "../errors";
import { forwardLog, type Auth } from "./auth";
import { clientBody, sendAuthResponse } from "./auth-response";
import { toFetchHeaders } from "./fetch-headers";
import { PASSKEY_PATHS, passkeyRoutes } from "./passkey-routes";

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

/** Ask for a code, sign in with it, sign out: passed on as they come. */
const CODE_PATHS = [
  "/auth/email-otp/send-verification-otp",
  "/auth/sign-in/email-otp",
  "/auth/sign-out",
] as const;

/**
 * The only Better Auth endpoints the apps use (the design, "Login", and the passkeys design,
 * "Better Auth"): the code routes and the four passkey routes, all `POST`. Better Auth has many
 * more (profile and password changes, session lists, other kinds of codes, listing and deleting
 * passkeys); they bypass our contract, so they are not mounted and answer 404.
 */
export const AUTH_PATHS = [...CODE_PATHS, ...PASSKEY_PATHS] as const;

/**
 * Better Auth's routes, mounted as its Fastify guide describes but per path instead of a
 * catch-all. They are the one exception to "Zod schemas are the API contract" and are hidden
 * from OpenAPI. Register with the prefix `/api`. The Origin hook on the root instance covers
 * them too.
 */
export const authRoutes: FastifyPluginAsync<{
  auth: Auth;
  origin: string;
  db: Db;
  queueMail: QueueMail;
}> = async (api, { auth, origin, db, queueMail }) => {
  await api.register(passkeyRoutes, { auth, origin, db, queueMail });
  for (const url of CODE_PATHS) {
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
        return sendAuthResponse(reply, response, await clientBody(response));
      },
    });
  }
};
