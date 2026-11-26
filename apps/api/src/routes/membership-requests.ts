import {
  apiErrorCodes,
  createMembershipRequestSchema,
  membershipRequestForReviewSchema,
  membershipRequestListResponseSchema,
  membershipRequestSchema,
  type MembershipRequest,
  type MembershipRequestForReview,
  type MembershipRequestListResponse,
} from "@padvinder/contracts";
import {
  createMembershipRequest,
  decideMembershipRequest,
  getMembershipRequestForReview,
  listReviewablePendingRequests,
  listRequestNotificationRecipients,
  withdrawMembershipRequest,
  type Db,
  type MembershipRequestRecord,
  type MembershipRequestReviewRecord,
} from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { apiError, errorResponses } from "../errors";
import { buildNewRequestMail, describeMailError, type Mailer } from "@padvinder/mail";
import { sendRequestDecidedMail } from "../mail/request-decided-mail";
import { sendInBackground } from "../mail/send-in-background";
import { authorize } from "../permissions/rules";
import {
  toMembershipRequest,
  toMembershipRequestForReview,
} from "../serializers/membership-requests";

/** The reviewer's target: the request's working group and its organization. */
const reviewTarget = (record: MembershipRequestReviewRecord) => ({
  workingGroupId: record.workingGroup.id,
  organizationId: record.organizationId,
});

const requestParamsSchema = z.object({ id: z.uuid() });

export const membershipRequestRoutes: FastifyPluginAsyncZod<{
  db: Db;
  mailer: Mailer;
  /** The origin of the links in mails (`PUBLIC_ORIGIN`). */
  publicOrigin: string;
}> = async (app, { db, mailer, publicOrigin }) => {
  const log: FastifyBaseLogger = app.log;

  /**
   * Called once for each request that was really created, after the commit; never for a resend.
   * Mails every recipient. Not awaited by the request; a failure is only logged, with the kind.
   */
  function afterMembershipRequestCreated(created: MembershipRequestRecord): void {
    // Part 2 (the portal) changes this to the portal's page for the request.
    const requestUrl = `${publicOrigin}/app/more/membership-requests/${created.id}`;
    // The applicant's name is not in the record the user may see: read it with the recipients.
    Promise.all([
      getMembershipRequestForReview(db, created.id),
      listRequestNotificationRecipients(db, created.workingGroup.id),
    ])
      .then(([request, recipients]) => {
        // Withdrawn or decided in the meantime (the applicant deleted their account, for one).
        if (!request || request.status !== "pending") return;
        if (recipients.length === 0) {
          // Nobody to tell: the group has no coordinator and its organization no admin. Only the
          // group's ID, no personal data.
          log.warn(
            { mailKind: "new-request", workingGroupId: request.workingGroup.id },
            "A new request has nobody to mail: no coordinator and no organization admin",
          );
          return;
        }
        sendInBackground(
          mailer,
          log,
          recipients.map((recipient) =>
            buildNewRequestMail({
              to: recipient.email,
              recipientName: recipient.name,
              applicantName: request.applicant.name,
              workingGroupName: request.workingGroup.name,
              requestUrl,
            }),
          ),
        );
      })
      .catch((error: unknown) => {
        log.error(
          { mailKind: "new-request", mailError: describeMailError(error) },
          "Finding the recipients of a mail failed",
        );
      });
  }

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
        case "user_not_found":
          // The account was deleted after its session was checked.
          throw apiError(401, apiErrorCodes.notLoggedIn, "Log in first");
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
    "/membership-requests",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listReviewableMembershipRequests",
        summary:
          "The pending requests of every group the user reviews, with the applicants' contact details. Empty for anyone who reviews nothing",
        response: {
          200: membershipRequestListResponseSchema,
          ...errorResponses(401),
        },
      },
    },
    async (request): Promise<MembershipRequestListResponse> => {
      const actor = request.actor!;
      const requests = await listReviewablePendingRequests(db, actor);
      return { membershipRequests: requests.map(toMembershipRequestForReview) };
    },
  );

  app.get(
    "/membership-requests/:id",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "getMembershipRequest",
        summary:
          "One request, any status, for its reviewers. The applicant's contact details only while pending",
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
            sendRequestDecidedMail({ mailer, log, publicOrigin }, result.request);
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
