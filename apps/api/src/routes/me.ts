import {
  apiErrorCodes,
  meResponseSchema,
  updateMeRequestSchema,
  type MeResponse,
} from "@padvinder/contracts";
import { getMeRoles, updateUserProfile, type Db, type UserProfile } from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Actor } from "../permissions/actor";
import { apiError, errorResponses } from "../errors";
import { toMembershipRequest } from "./membership-requests";

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
};
