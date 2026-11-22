import {
  apiErrorCodes,
  createMembershipRequestSchema,
  membershipRequestForReviewSchema,
  membershipRequestSchema,
  type MembershipRequest,
  type MembershipRequestForReview,
} from "@padvinder/contracts";
import {
  createMembershipRequest,
  decideMembershipRequest,
  getMembershipRequestForReview,
  withdrawMembershipRequest,
  type Db,
  type MembershipRequestRecord,
  type MembershipRequestReviewRecord,
} from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiError, errorResponses } from "../errors";
import { authorize } from "../permissions/rules";
import {
  toMembershipRequest,
  toMembershipRequestForReview,
} from "../serializers/membership-requests";

/**
 * Called once for each request that was really created, after the commit; never for a resend.
 * The mail to the group's coordinators goes out from here (Task 5). It must not be awaited by
 * the request, and a failure is only logged.
 */
function afterMembershipRequestCreated(_request: MembershipRequestRecord): void {
  // Nothing yet.
}

/**
 * Called once for each request that was really approved or rejected, after the commit; never for
 * the same decision again. The mail to the applicant goes out from here (Task 5). It must not be
 * awaited by the request, and a failure is only logged.
 */
function afterMembershipRequestDecided(_request: MembershipRequestReviewRecord): void {
  // Nothing yet.
}

/** The reviewer's target: the request's working group and its organization. */
const reviewTarget = (record: MembershipRequestReviewRecord) => ({
  workingGroupId: record.workingGroup.id,
  organizationId: record.organizationId,
});

const requestParamsSchema = z.object({ id: z.uuid() });

export const membershipRequestRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // Every logged-in user may ask to join a group and withdraw their own request, so these two
  // have no `authorize` call: a request is only ever found for its own user.
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
  // Reviewing: only a coordinator of the request's group, an admin of its organization or a
  // platform admin. A request that does not exist is the same 404 an outsider gets.

  app.get(
    "/membership-requests/:id",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "getMembershipRequest",
        summary: "One request with the applicant's contact details, for its reviewers. Any status",
        params: requestParamsSchema,
        response: { 200: membershipRequestForReviewSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request): Promise<MembershipRequestForReview> => {
      const record = await getMembershipRequestForReview(db, request.params.id);
      if (!record) throw apiError(404, apiErrorCodes.notFound, "Not found");
      authorize(request.actor!, {
        action: "workingGroup.reviewRequests",
        target: reviewTarget(record),
      });
      return toMembershipRequestForReview(record);
    },
  );

  for (const [path, decision, operationId, summary] of [
    [
      "approve",
      "approved",
      "approveMembershipRequest",
      "Approve a pending request: the applicant becomes a volunteer of the group",
    ],
    ["reject", "rejected", "rejectMembershipRequest", "Reject a pending request"],
  ] as const) {
    app.post(
      `/membership-requests/:id/${path}`,
      {
        preHandler: app.requireActor,
        schema: {
          operationId,
          summary: `${summary}. The same decision again returns the stored request`,
          params: requestParamsSchema,
          response: {
            200: membershipRequestForReviewSchema,
            ...errorResponses(400, 401, 403, 404, 409),
          },
        },
      },
      async (request): Promise<MembershipRequestForReview> => {
        // A request never moves to another group, so the check may come before the transaction.
        // An admin may decide their own request: the spec allows it, and they hold those rights.
        const record = await getMembershipRequestForReview(db, request.params.id);
        if (!record) throw apiError(404, apiErrorCodes.notFound, "Not found");
        authorize(request.actor!, {
          action: "workingGroup.reviewRequests",
          target: reviewTarget(record),
        });
        const result = await decideMembershipRequest(db, {
          id: request.params.id,
          decision,
          decidedBy: request.actor!.userId,
          now: new Date(),
        });
        switch (result.outcome) {
          case "decided":
            afterMembershipRequestDecided(result.request);
            return toMembershipRequestForReview(result.request);
          case "unchanged":
            return toMembershipRequestForReview(result.request);
          case "not_found":
            // Deleted between the two reads (the applicant deleted their account).
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
  }
};
