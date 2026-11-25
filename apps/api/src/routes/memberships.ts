import {
  apiErrorCodes,
  memberSchema,
  updateMembershipRequestSchema,
  type Member,
} from "@padvinder/contracts";
import { getMember, getMembership, removeMembership, setCoordinator, type Db } from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { mapAdminErrors } from "../admin-errors";
import { apiError, errorResponses } from "../errors";
import { authorize } from "../permissions/rules";

const paramsSchema = z.object({ membershipId: z.uuid() });

export const membershipRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.delete(
    "/memberships/:membershipId",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "removeMembership",
        summary:
          "Remove a member from a working group. A coordinator may not remove a coordinator, and the last coordinator of an active group stays",
        params: paramsSchema,
        response: { 204: z.null(), ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const membership = await getMembership(db, request.params.membershipId);
      if (!membership) throw apiError(404, apiErrorCodes.notFound, "Not found");
      authorize(request.actor!, {
        action: "workingGroup.removeMember",
        target: {
          workingGroupId: membership.workingGroupId,
          organizationId: membership.organizationId,
        },
        memberIsCoordinator: membership.isCoordinator,
      });
      // The decision was made on this flag; the delete only goes through while it still holds.
      const result = await removeMembership(db, {
        membershipId: membership.membershipId,
        removedBy: request.actor!.userId,
        expectedIsCoordinator: membership.isCoordinator,
      });
      switch (result.outcome) {
        case "removed":
          return reply.code(204).send(null);
        case "not_found":
          throw apiError(404, apiErrorCodes.notFound, "Not found");
        case "coordinator_changed":
          throw apiError(409, apiErrorCodes.membershipChanged, "The membership changed");
        case "last_coordinator":
          throw apiError(
            409,
            apiErrorCodes.lastCoordinator,
            "The member is the last coordinator of an active working group",
          );
        default: {
          const unreachable: never = result;
          throw new Error(`Unknown outcome ${JSON.stringify(unreachable)}`);
        }
      }
    },
  );

  app.patch(
    "/memberships/:membershipId",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "updateMembership",
        summary:
          "Make a member coordinator or a plain volunteer (admins of the organization and platform admins). The last coordinator of an active group stays",
        params: paramsSchema,
        body: updateMembershipRequestSchema,
        response: { 200: memberSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request): Promise<Member> => {
      const actor = request.actor!;
      const membership = await getMembership(db, request.params.membershipId);
      if (!membership) throw apiError(404, apiErrorCodes.notFound, "Not found");
      authorize(actor, {
        action: "workingGroup.setCoordinator",
        target: {
          workingGroupId: membership.workingGroupId,
          organizationId: membership.organizationId,
        },
      });
      await mapAdminErrors(() =>
        setCoordinator(
          db,
          { membershipId: membership.membershipId, isCoordinator: request.body.isCoordinator },
          { kind: "user", userId: actor.userId },
        ),
      );
      const member = await getMember(db, membership.membershipId);
      if (!member) throw apiError(404, apiErrorCodes.notFound, "Not found");
      return member;
    },
  );
};
