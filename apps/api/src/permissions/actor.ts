import { apiErrorCodes } from "@padvinder/contracts";
import { type Access, type Db, getAccess } from "@padvinder/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { apiError } from "../errors";

/**
 * Who is making the request, with what they may be: memberships, organization admin rows and
 * the platform flag. Routes reach the user only through `request.actor`, set by
 * `app.requireActor`, and decide only through `authorize` or `decide`.
 */
export type Actor = { userId: string } & Access;

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
  interface FastifyInstance {
    /** A `preHandler`: sets `request.actor`, or answers 401 `not_logged_in`. */
    requireActor: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function toHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const item of [value].flat()) headers.append(name, item);
  }
  return headers;
}

async function readSession(app: FastifyInstance, db: Db, request: FastifyRequest) {
  // Throws on a database failure: that is a 500, not "logged out". `returnHeaders` keeps the
  // refreshed cookie of a session that is renewed (once a day), so the caller can pass it on.
  const { headers, response } = await app.auth.api.getSession({
    headers: toHeaders(request),
    returnHeaders: true,
  });
  if (!response) return { actor: null, headers };
  // A session whose user row is gone is not an actor (401). A database failure throws (500).
  const access = await getAccess(db, response.user.id);
  return { actor: access ? { userId: response.user.id, ...access } : null, headers };
}

/**
 * The actor of the session cookie, or `null` when there is no valid session. The one place
 * that turns a request into an actor. A database failure throws (500), it is not "logged out".
 */
export async function loadActor(
  app: FastifyInstance,
  db: Db,
  request: FastifyRequest,
): Promise<Actor | null> {
  return (await readSession(app, db, request)).actor;
}

export function addActorLoading(app: FastifyInstance, db: Db): void {
  app.decorateRequest("actor", undefined);
  app.decorate("requireActor", async (request: FastifyRequest, reply: FastifyReply) => {
    const { actor, headers } = await readSession(app, db, request);
    // A renewed session sets a fresh cookie, so an active user stays logged in.
    const setCookies = headers.getSetCookie();
    if (actor && setCookies.length > 0) void reply.header("set-cookie", setCookies);
    if (!actor) throw apiError(401, apiErrorCodes.notLoggedIn, "Log in first");
    request.actor = actor;
  });
}
