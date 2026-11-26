import {
  accountDeletionBlockedSchema,
  accountSummarySchema,
  apiErrorCodes,
  findAccountRequestSchema,
  type AccountSummary,
} from "@padvinder/contracts";
import { deleteAccount, findAccountByEmail, type Db } from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiError, apiErrorBody, errorResponses } from "../errors";
import { authorize } from "../permissions/rules";

const userParamsSchema = z.object({ userId: z.uuid() });

/**
 * Looking up an account and deleting it for someone, for platform admins only. The address goes
 * in the body of the lookup, never in the path or the query, so no request log holds it; no
 * answer repeats it except the account itself.
 */
export const userRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.post(
    "/users/lookup",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "findAccount",
        summary:
          "The account with exactly this address (platform admins). Changes nothing; 404 when no account has it",
        body: findAccountRequestSchema,
        response: { 200: accountSummarySchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request): Promise<AccountSummary> => {
      // Decided before the address is read, so nobody else learns whether an account exists.
      authorize(request.actor!, { action: "platform.deleteAccounts" });
      const account = await findAccountByEmail(db, request.body.email);
      if (!account) throw apiError(404, apiErrorCodes.notFound, "No account has this address");
      return account;
    },
  );

  app.delete(
    "/users/:userId",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "deleteUser",
        summary:
          "Delete someone's account (platform admins), as `DELETE /api/me` does: refused for the only platform admin, and for the only coordinator of an active working group or admin of an organization (with `blockers`). Never the actor's own account",
        params: userParamsSchema,
        response: {
          204: z.null(),
          ...errorResponses(400, 401, 403, 404),
          409: accountDeletionBlockedSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = request.actor!;
      authorize(actor, { action: "platform.deleteAccounts" });
      const { userId } = request.params;
      // Their own account goes through the app, which also ends the session properly.
      if (userId === actor.userId) {
        throw apiError(
          409,
          apiErrorCodes.ownAccount,
          "Delete your own account with DELETE /api/me",
        );
      }
      const result = await deleteAccount(db, {
        userId,
        now: new Date(),
        deletedBy: { kind: "user", userId: actor.userId },
      });
      switch (result.outcome) {
        case "deleted":
          // `deleteAccount` ended the sessions; its `access-changed` closes the person's open apps.
          return reply.code(204).send(null);
        case "not_found":
          throw apiError(404, apiErrorCodes.notFound, "No such account, or it was deleted");
        case "last_platform_admin":
          throw apiError(
            409,
            apiErrorCodes.lastPlatformAdmin,
            "The only platform admin who has logged in cannot be deleted",
          );
        case "blocked": {
          // The same answer as `DELETE /api/me`: groups come first in `blockers`.
          const isCoordinator = result.blockers[0]?.role === "coordinator";
          return reply.code(409).send({
            ...apiErrorBody(
              409,
              isCoordinator ? apiErrorCodes.lastCoordinator : apiErrorCodes.lastOrganizationAdmin,
              "The only coordinator of an active working group or admin of an organization cannot be deleted",
            ),
            blockers: result.blockers,
          });
        }
        case "kept":
          // Only with `onlyIfUnused`, which this route does not pass.
          throw new Error("A deletion by a platform admin was kept");
        default: {
          const unreachable: never = result;
          throw new Error(`Unknown outcome ${JSON.stringify(unreachable)}`);
        }
      }
    },
  );
};
