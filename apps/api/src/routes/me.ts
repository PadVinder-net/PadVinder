import {
  accountDeletionBlockedSchema,
  apiErrorCodes,
  meResponseSchema,
  updateMeRequestSchema,
  type MeResponse,
} from "@padvinder/contracts";
import {
  deleteAccount,
  getMeRoles,
  updateUserProfile,
  type Db,
  type UserProfile,
} from "@padvinder/db";
import { getCookies } from "better-auth/cookies";
import type { FastifyInstance } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Actor } from "../permissions/actor";
import { apiError, apiErrorBody, errorResponses } from "../errors";
import { toMembershipRequest } from "../serializers/membership-requests";

type CookieAttributes = {
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string | boolean;
};

/** A Set-Cookie value that removes the cookie: the same name and attributes, empty, Max-Age 0. */
function expiredCookie(name: string, attributes: CookieAttributes): string {
  const parts = [`${name}=`, "Max-Age=0", `Path=${attributes.path ?? "/"}`];
  if (attributes.domain) parts.push(`Domain=${attributes.domain}`);
  if (attributes.httpOnly) parts.push("HttpOnly");
  if (attributes.secure) parts.push("Secure");
  if (typeof attributes.sameSite === "string") {
    const sameSite = attributes.sameSite.toLowerCase();
    parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);
  }
  return parts.join("; ");
}

/**
 * The cookies Better Auth's sign-out clears, with the names and attributes Better Auth gives them
 * (prefix, `__Secure-` on https, HttpOnly, SameSite=Lax), so the browser drops exactly those.
 */
function clearedSessionCookies(app: FastifyInstance): string[] {
  const cookies = getCookies(app.auth.options);
  return [cookies.sessionToken, cookies.sessionData, cookies.dontRememberToken].map((cookie) =>
    expiredCookie(cookie.name, cookie.attributes),
  );
}

export const meRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  /** The profile and the platform flag come from the actor, read with the session. */
  async function toMe(actor: Actor, user: UserProfile): Promise<MeResponse> {
    const { membershipRequest, ...roles } = await getMeRoles(db, actor.userId);
    return {
      user: { ...user, isPlatformAdmin: actor.isPlatformAdmin },
      ...roles,
      membershipRequest: membershipRequest && toMembershipRequest(membershipRequest),
    };
  }

  app.get(
    "/me",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "getMe",
        summary: "The logged-in user",
        response: { 200: meResponseSchema, ...errorResponses(401) },
      },
    },
    async (request): Promise<MeResponse> => toMe(request.actor!, request.actor!.user),
  );

  app.patch(
    "/me",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "updateMe",
        summary: "Change the name or phone number of the logged-in user",
        body: updateMeRequestSchema,
        response: { 200: meResponseSchema, ...errorResponses(400, 401) },
      },
    },
    async (request): Promise<MeResponse> => {
      const user = await updateUserProfile(db, request.actor!.userId, request.body);
      // The user row was removed after the session was read: treat as logged out.
      if (!user) throw apiError(401, apiErrorCodes.notLoggedIn, "Log in first");
      return toMe(request.actor!, user);
    },
  );

  app.delete(
    "/me",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "deleteMe",
        summary:
          "Delete the account of the logged-in user: the name, address and phone are wiped, the sessions end. Refused for the only platform admin, and for the only coordinator of an active working group or admin of an organization (with `blockers`)",
        response: { 204: z.null(), ...errorResponses(401), 409: accountDeletionBlockedSchema },
      },
    },
    async (request, reply) => {
      const result = await deleteAccount(db, { userId: request.actor!.userId, now: new Date() });
      switch (result.outcome) {
        case "deleted":
          // The sessions are gone already; the browser drops the cookie too.
          return reply.code(204).header("set-cookie", clearedSessionCookies(app)).send(null);
        case "not_found":
          throw apiError(401, apiErrorCodes.notLoggedIn, "Log in first");
        case "last_platform_admin":
          throw apiError(
            409,
            apiErrorCodes.lastPlatformAdmin,
            "The only platform admin cannot delete their account",
          );
        case "blocked": {
          // The session stays: nothing changed. Groups come first in `blockers`.
          const isCoordinator = result.blockers[0]?.role === "coordinator";
          return reply.code(409).send({
            ...apiErrorBody(
              409,
              isCoordinator ? apiErrorCodes.lastCoordinator : apiErrorCodes.lastOrganizationAdmin,
              "The only coordinator of an active working group or admin of an organization cannot delete their account",
            ),
            blockers: result.blockers,
          });
        }
        default: {
          const unreachable: never = result;
          throw new Error(`Unknown outcome ${JSON.stringify(unreachable)}`);
        }
      }
    },
  );
};
