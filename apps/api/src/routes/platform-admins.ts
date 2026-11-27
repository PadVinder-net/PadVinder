import {
  addPlatformAdminRequestSchema,
  apiErrorCodes,
  platformAdminListResponseSchema,
  type PlatformAdminListResponse,
} from "@padvinder/contracts";
import {
  grantPlatformAdmin,
  listPlatformAdmins,
  removePlatformAdmin,
  type Db,
} from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { mapAdminErrors } from "../admin-errors";
import { apiError, errorResponses } from "../errors";
import { authorize } from "../permissions/rules";

const platformAdminParamsSchema = z.object({ userId: z.uuid() });

/**
 * The platform admins, for platform admins only. Appointing makes the account when the address
 * has none, and sends no mail: whoever appoints someone tells them. Removing never takes away the
 * last platform admin who has logged in.
 */
export const platformAdminRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const listResponse = async (): Promise<PlatformAdminListResponse> => ({
    platformAdmins: await listPlatformAdmins(db),
  });

  app.get(
    "/platform-admins",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listPlatformAdmins",
        summary: "The platform admins (platform admins)",
        response: { 200: platformAdminListResponseSchema, ...errorResponses(401, 403) },
      },
    },
    async (request): Promise<PlatformAdminListResponse> => {
      authorize(request.actor!, { action: "platform.listPlatformAdmins" });
      return listResponse();
    },
  );

  app.post(
    "/platform-admins",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "addPlatformAdmin",
        summary: "Make someone a platform admin (platform admins). Also 200 when they were",
        body: addPlatformAdminRequestSchema,
        response: { 200: platformAdminListResponseSchema, ...errorResponses(400, 401, 403) },
      },
    },
    async (request): Promise<PlatformAdminListResponse> => {
      const actor = request.actor!;
      authorize(actor, { action: "platform.managePlatformAdmins" });
      await mapAdminErrors(
        () =>
          grantPlatformAdmin(
            db,
            { email: request.body.email },
            { kind: "user", userId: actor.userId },
          ),
        { email: "email" },
      );
      return listResponse();
    },
  );

  app.delete(
    "/platform-admins/:userId",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "removePlatformAdmin",
        summary:
          "Take the platform admin role away (platform admins). Never the last one who has logged in",
        params: platformAdminParamsSchema,
        response: { 204: z.null(), ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const actor = request.actor!;
      authorize(actor, { action: "platform.managePlatformAdmins" });
      const { changed } = await mapAdminErrors(() =>
        removePlatformAdmin(
          db,
          { userId: request.params.userId },
          { kind: "user", userId: actor.userId },
        ),
      );
      if (!changed) {
        throw apiError(404, apiErrorCodes.notFound, "This person is no platform admin");
      }
      return reply.code(204).send(null);
    },
  );
};
