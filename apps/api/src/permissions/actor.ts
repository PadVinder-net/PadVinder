import { apiErrorCodes } from "@padvinder/contracts";
import { type Access, type Db, getAccess, type UserProfile } from "@padvinder/db";
import { setMonitoringUser } from "@padvinder/monitoring";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { toFetchHeaders } from "../auth/fetch-headers";
import { apiError } from "../errors";

/**
 * Who is making the request, with what they may be: memberships, organization admin rows and
 * the platform flag. `user` is the profile as read with the session, in the same query. Routes
 * reach the user only through `request.actor`, set by `app.requireActor`, and decide only through
 * `authorize` or `decide`.
 */
export type Actor = { userId: string; user: UserProfile } & Access;

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
 * is gone). A database failure throws (500), it is not "logged out". With `renew`, a session that
 * is due (once a day) is extended, and the returned headers carry its refreshed cookie, which the
 * caller must pass on: the database would otherwise outlive the browser's cookie.
 */
async function readSession(
  app: FastifyInstance,
  db: Db,
  request: FastifyRequest,
  { renew }: { renew: boolean },
) {
  const { headers, response } = await app.auth.api.getSession({
    headers: toFetchHeaders(request),
    query: { disableRefresh: !renew },
    returnHeaders: true,
  });
  if (!response) return { actor: null, headers };
  const { id, name, email, phone } = response.user;
  const access = await getAccess(db, id);
  if (!access) return { actor: null, headers };
  const actor: Actor = { userId: id, user: { id, name, email, phone: phone ?? null }, ...access };
  return { actor, headers };
}

/**
 * Makes the actor's account ID (only that) the Sentry user of the current request. Called only by
 * `requireActor`, on a request's own path: elsewhere (a notification callback, a timer) the
 * current isolation scope is the process's, and every later request would inherit the user.
 */
function identify(actor: Actor | null): void {
  setMonitoringUser(actor?.userId ?? null);
}

/**
 * The actor of the session cookie, or `null` when there is no valid session, for a request that
 * cannot pass on a cookie (an open event stream) or does not need a login (health). It never
 * renews the session: that is left to `requireActor`, which sets the refreshed cookie. It never
 * makes the actor the Sentry user either: the event stream's reloads run outside the request
 * (see `identify`).
 */
export async function loadActor(
  app: FastifyInstance,
  db: Db,
  request: FastifyRequest,
): Promise<Actor | null> {
  const { actor } = await readSession(app, db, request, { renew: false });
  return actor;
}

export function addActorLoading(app: FastifyInstance, db: Db): void {
  app.decorateRequest("actor", undefined);
  app.decorate("requireActor", async (request: FastifyRequest, reply: FastifyReply) => {
    const { actor, headers } = await readSession(app, db, request, { renew: true });
    identify(actor);
    // A renewed session sets a fresh cookie, so an active user stays logged in.
    const setCookies = headers.getSetCookie();
    if (actor && setCookies.length > 0) void reply.header("set-cookie", setCookies);
    if (!actor) throw apiError(401, apiErrorCodes.notLoggedIn, "Log in first");
    request.actor = actor;
  });
}
