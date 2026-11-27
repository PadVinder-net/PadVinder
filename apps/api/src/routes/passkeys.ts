import {
  apiErrorCodes,
  passkeyListResponseSchema,
  type PasskeyListResponse,
} from "@padvinder/contracts";
import {
  listOwnPasskeys,
  organizationAdmins,
  removeOwnPasskey,
  resetAdminPasskeys,
  users,
  type Db,
  type QueueMail,
} from "@padvinder/db";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiError, errorResponses } from "../errors";
import { authorize } from "../permissions/rules";

const passkeyParamsSchema = z.object({ passkeyId: z.uuid() });
const organizationAdminParamsSchema = z.object({ organizationId: z.uuid(), userId: z.uuid() });
const platformAdminParamsSchema = z.object({ userId: z.uuid() });

const ownAccount = () =>
  apiError(409, apiErrorCodes.ownAccount, "Your own passkeys are removed on your own screen");

function throwUnlessReset(result: { outcome: "reset" | "not_found" | "subject_changed" }): void {
  if (result.outcome === "not_found") {
    throw apiError(404, apiErrorCodes.notFound, "This person is no such admin");
  }
  if (result.outcome === "subject_changed") {
    throw apiError(409, apiErrorCodes.membershipChanged, "The person's role changed");
  }
}

/**
 * Our own passkey endpoints: an admin lists and removes their own passkeys, and an admin resets
 * another admin's. Making a passkey and using one go through Better Auth's routes. Answers
 * hold no key material: only the ID, the date and whether it is backed up.
 */
export const passkeyRoutes: FastifyPluginAsyncZod<{ db: Db; queueMail: QueueMail }> = async (
  app,
  { db, queueMail },
) => {
  app.get(
    "/passkeys",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listPasskeys",
        summary: "The logged-in admin's own passkeys, oldest first",
        response: { 200: passkeyListResponseSchema, ...errorResponses(401, 403) },
      },
    },
    async (request): Promise<PasskeyListResponse> => {
      const actor = request.actor!;
      authorize(actor, { action: "passkeys.listOwn" });
      const rows = await listOwnPasskeys(db, actor.userId);
      return {
        passkeys: rows.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          backedUp: row.backedUp,
        })),
      };
    },
  );

  app.delete(
    "/passkeys/:passkeyId",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "removePasskey",
        summary: "Remove one of the logged-in admin's own passkeys; 404 for another person's",
        params: passkeyParamsSchema,
        response: { 204: z.null(), ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request, reply) => {
      const actor = request.actor!;
      authorize(actor, { action: "passkeys.removeOwn" });
      const result = await removeOwnPasskey(
        db,
        { userId: actor.userId, passkeyId: request.params.passkeyId },
        { queueMail },
      );
      if (result.outcome === "not_found") {
        throw apiError(404, apiErrorCodes.notFound, "No such passkey");
      }
      return reply.code(204).send(null);
    },
  );

  app.delete(
    "/organizations/:organizationId/admins/:userId/passkeys",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "resetOrganizationAdminPasskeys",
        summary:
          "Remove all passkeys of an admin of the organization (its admins and platform admins), for someone who lost their device. Never one's own; an organization admin cannot reset a platform admin's",
        params: organizationAdminParamsSchema,
        response: { 204: z.null(), ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const actor = request.actor!;
      const { organizationId, userId } = request.params;
      if (userId === actor.userId) throw ownAccount();
      // An outsider gets 404 whatever the target.
      authorize(actor, { action: "organization.view", target: { organizationId } });
      const [subject] = await db
        .select({ isPlatformAdmin: users.isPlatformAdmin })
        .from(organizationAdmins)
        .innerJoin(users, eq(users.id, organizationAdmins.userId))
        .where(
          and(
            eq(organizationAdmins.organizationId, organizationId),
            eq(organizationAdmins.userId, userId),
            isNull(users.deletedAt),
          ),
        );
      if (!subject) throw apiError(404, apiErrorCodes.notFound, "This person is no admin there");
      authorize(actor, {
        action: "organization.resetAdminPasskeys",
        target: { organizationId },
        subjectIsPlatformAdmin: subject.isPlatformAdmin,
      });
      const result = await resetAdminPasskeys(
        db,
        { userId, organizationId, expectedIsPlatformAdmin: subject.isPlatformAdmin },
        { kind: "user", userId: actor.userId },
        { queueMail },
      );
      throwUnlessReset(result);
      return reply.code(204).send(null);
    },
  );

  app.delete(
    "/platform-admins/:userId/passkeys",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "resetPlatformAdminPasskeys",
        summary:
          "Remove all passkeys of a platform admin (platform admins), for someone who lost their device. Never one's own",
        params: platformAdminParamsSchema,
        response: { 204: z.null(), ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const actor = request.actor!;
      const { userId } = request.params;
      if (userId === actor.userId) throw ownAccount();
      authorize(actor, { action: "platform.resetPlatformAdminPasskeys" });
      const result = await resetAdminPasskeys(
        db,
        { userId, organizationId: null, expectedIsPlatformAdmin: true },
        { kind: "user", userId: actor.userId },
        { queueMail },
      );
      throwUnlessReset(result);
      return reply.code(204).send(null);
    },
  );
};
