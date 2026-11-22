import {
  apiErrorCodes,
  createMembershipRequestSchema,
  membershipRequestSchema,
  type MembershipRequest,
} from "@padvinder/contracts";
import {
  createMembershipRequest,
  withdrawMembershipRequest,
  type Db,
  type MembershipRequestRecord,
} from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiError, errorResponses } from "../errors";

/** The answer for the applicant: every field is picked by name, so `userId` and `receivedAt` stay out. */
export function toMembershipRequest(record: MembershipRequestRecord): MembershipRequest {
  return {
    id: record.id,
    status: record.status,
    requestedAt: record.requestedAt.toISOString(),
    decidedAt: record.decidedAt?.toISOString() ?? null,
    workingGroup: record.workingGroup,
  };
}

/**
 * Called once for each request that was really created, after the commit; never for a resend.
 * The mail to the group's coordinators goes out from here (Task 5). It must not be awaited by
 * the request, and a failure is only logged.
 */
function afterMembershipRequestCreated(_request: MembershipRequestRecord): void {
  // Nothing yet.
}

const requestParamsSchema = z.object({ id: z.uuid() });

export const membershipRequestRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // Every logged-in user may ask to join a group and withdraw their own request, so there is no
  // `authorize` call: a request is only ever found for its own user.
  app.post(
    "/membership-requests",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "createMembershipRequest",
        summary:
          "Ask to join a working group. Sending the same id again returns the stored request",
        body: createMembershipRequestSchema,
        response: {
          200: membershipRequestSchema,
          201: membershipRequestSchema,
          ...errorResponses(400, 401, 404, 409, 429),
        },
      },
    },
    async (request, reply): Promise<MembershipRequest> => {
      const result = await createMembershipRequest(db, {
        id: request.body.id,
        userId: request.actor!.userId,
        workingGroupId: request.body.workingGroupId,
        requestedAt: new Date(request.body.requestedAt),
        now: new Date(),
      });
      switch (result.outcome) {
        case "created":
          afterMembershipRequestCreated(result.request);
          reply.code(201);
          return toMembershipRequest(result.request);
        case "existing":
          return toMembershipRequest(result.request);
        case "id_in_use":
          throw apiError(409, apiErrorCodes.idInUse, "This id belongs to another request");
        case "working_group_not_found":
          throw apiError(404, apiErrorCodes.notFound, "Working group not found");
        case "already_member":
          throw apiError(409, apiErrorCodes.alreadyMember, "Already a member of this group");
        case "already_requested":
          throw apiError(
            409,
            apiErrorCodes.alreadyRequested,
            "There is a pending request for this group",
          );
        case "too_many_requests":
          throw apiError(
            429,
            apiErrorCodes.tooManyRequests,
            "Too many membership requests in 24 hours",
          );
        default: {
          const unreachable: never = result;
          throw new Error(`Unknown outcome ${JSON.stringify(unreachable)}`);
        }
      }
    },
  );

  app.post(
    "/membership-requests/:id/withdraw",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "withdrawMembershipRequest",
        summary: "Withdraw your own pending request",
        params: requestParamsSchema,
        response: { 200: membershipRequestSchema, ...errorResponses(400, 401, 404, 409) },
      },
    },
    async (request): Promise<MembershipRequest> => {
      const result = await withdrawMembershipRequest(db, {
        id: request.params.id,
        userId: request.actor!.userId,
        now: new Date(),
      });
      switch (result.outcome) {
        case "withdrawn":
        case "unchanged":
          return toMembershipRequest(result.request);
        case "not_found":
          throw apiError(404, apiErrorCodes.notFound, "Not found");
        case "already_decided":
          throw apiError(409, apiErrorCodes.alreadyDecided, "The request was already decided");
        default: {
          const unreachable: never = result;
          throw new Error(`Unknown outcome ${JSON.stringify(unreachable)}`);
        }
      }
    },
  );
};
