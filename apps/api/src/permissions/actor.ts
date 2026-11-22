import { apiErrorCodes } from "@padvinder/contracts";
import type { UserProfile } from "@padvinder/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { toFetchHeaders } from "../auth/fetch-headers";
import { apiError } from "../errors";

/**
 * Who is making the request. Routes reach the user only through `request.actor`, set by
 * `app.requireActor`. `user` is the profile as read with the session, in the same query. Plan 2
 * adds the memberships here.
 */
export type Actor = { user: UserProfile };

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
  interface FastifyInstance {
    /** A `preHandler`: sets `request.actor`, or answers 401 `not_logged_in`. */
    requireActor: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * The actor of the session cookie, or `null` when there is no valid session (also when its user
 * is gone). The one place that turns a request into an actor. A database failure throws (500), it
 * is not "logged out". The headers carry the refreshed cookie of a session that is renewed (once a
 * day), so the caller can pass it on.
 */
async function readSession(app: FastifyInstance, request: FastifyRequest) {
  const { headers, response } = await app.auth.api.getSession({
    headers: toFetchHeaders(request),
    returnHeaders: true,
  });
  if (!response) return { actor: null, headers };
  const { id, name, email, phone } = response.user;
  return { actor: { user: { id, name, email, phone: phone ?? null } }, headers };
}

export function addActorLoading(app: FastifyInstance): void {
  app.decorateRequest("actor", undefined);
  app.decorate("requireActor", async (request: FastifyRequest, reply: FastifyReply) => {
    const { actor, headers } = await readSession(app, request);
    // A renewed session sets a fresh cookie, so an active user stays logged in.
    const setCookies = headers.getSetCookie();
    if (actor && setCookies.length > 0) void reply.header("set-cookie", setCookies);
    if (!actor) throw apiError(401, apiErrorCodes.notLoggedIn, "Log in first");
    request.actor = actor;
  });
}
