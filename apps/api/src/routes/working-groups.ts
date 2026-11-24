import {
  apiErrorCodes,
  memberListResponseSchema,
  membershipRequestListResponseSchema,
  workingGroupDirectoryResponseSchema,
  type MemberListResponse,
  type MembershipRequestListResponse,
  type WorkingGroupDirectoryResponse,
} from "@padvinder/contracts";
import {
  getWorkingGroup,
  listMembers,
  listPendingMembershipRequests,
  listWorkingGroupDirectory,
  type Db,
} from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiError, errorResponses } from "../errors";
import { authorize, decide } from "../permissions/rules";
import { toMembershipRequestForReview } from "../serializers/membership-requests";

const workingGroupParamsSchema = z.object({ workingGroupId: z.uuid() });

export const workingGroupRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // Every logged-in user may list the working groups, so there is no `authorize` call. This is
  // the one list that crosses organizations: a new volunteer picks a group from it.
  app.get(
    "/working-groups",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listWorkingGroups",
        summary: "The active working groups of all organizations",
        response: { 200: workingGroupDirectoryResponseSchema, ...errorResponses(401) },
      },
    },
    async (): Promise<WorkingGroupDirectoryResponse> => ({
      workingGroups: await listWorkingGroupDirectory(db),
    }),
  );

  app.get(
    "/working-groups/:workingGroupId/membership-requests",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listMembershipRequests",
        summary:
          "The group's pending requests with the applicants' contact details, oldest first. For its reviewers",
        params: workingGroupParamsSchema,
        response: {
          200: membershipRequestListResponseSchema,
          ...errorResponses(400, 401, 403, 404),
        },
      },
    },
    async (request): Promise<MembershipRequestListResponse> => {
      // A group that does not exist is the same 404 an outsider gets.
      const group = await getWorkingGroup(db, request.params.workingGroupId);
      if (!group) throw apiError(404, apiErrorCodes.notFound, "Not found");
      authorize(request.actor!, {
        action: "workingGroup.reviewRequests",
        target: { workingGroupId: group.workingGroupId, organizationId: group.organizationId },
      });
      const requests = await listPendingMembershipRequests(db, group.workingGroupId);
      return { membershipRequests: requests.map(toMembershipRequestForReview) };
    },
  );

  app.get(
    "/working-groups/:workingGroupId/members",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listMembers",
        summary:
          "The members of a working group by name. Email and phone only for its coordinators and admins",
        params: workingGroupParamsSchema,
        response: { 200: memberListResponseSchema, ...errorResponses(400, 401, 404) },
      },
    },
    async (request): Promise<MemberListResponse> => {
      const group = await getWorkingGroup(db, request.params.workingGroupId);
      if (!group) throw apiError(404, apiErrorCodes.notFound, "Not found");
      const target = { workingGroupId: group.workingGroupId, organizationId: group.organizationId };
      authorize(request.actor!, { action: "workingGroup.listMembers", target });
      const contact =
        decide(request.actor!, { action: "workingGroup.viewMemberContact", target }) === "allowed";
      return { members: await listMembers(db, group.workingGroupId, { contact }) };
    },
  );
};
