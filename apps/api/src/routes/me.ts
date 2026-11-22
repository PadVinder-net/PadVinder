import { meResponseSchema, updateMeRequestSchema, type MeResponse } from "@padvinder/contracts";
import { updateUserProfile, type Db } from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponses } from "../errors";

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
    // Read together with the session by `requireActor`: no second query.
    async (request): Promise<MeResponse> => ({ user: request.actor!.user }),
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
      const user = await updateUserProfile(db, request.actor!.user.id, request.body);
      return { user };
    },
  );
};
