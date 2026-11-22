import {
  apiErrorCodes,
  meResponseSchema,
  updateMeRequestSchema,
  type MeResponse,
} from "@padvinder/contracts";
import { getUserProfile, updateUserProfile, type Db } from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { apiError, errorResponses } from "../errors";

export const meRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
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
    async (request): Promise<MeResponse> => {
      const user = await getUserProfile(db, request.actor!.userId);
      // A session of a user that is gone: treat as logged out.
      if (!user) throw apiError(401, apiErrorCodes.notLoggedIn, "Log in first");
      return { user };
    },
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
      return { user };
    },
  );
};
