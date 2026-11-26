import {
  addMembersRequestSchema,
  addMembersResponseSchema,
  apiErrorCodes,
  MAX_ADDRESSES_PER_REQUEST,
  managedWorkingGroupListResponseSchema,
  managedWorkingGroupSchema,
  memberListResponseSchema,
  membershipRequestListResponseSchema,
  workingGroupDirectoryResponseSchema,
  updateWorkingGroupRequestSchema,
  type AddMembersResponse,
  type ManagedWorkingGroup,
  type ManagedWorkingGroupListResponse,
  type MemberListResponse,
  type MembershipRequestListResponse,
  type WorkingGroupDirectoryResponse,
} from "@padvinder/contracts";
import {
  addMemberByEmail,
  countAdditionsInLastDay,
  getManagedWorkingGroup,
  getWorkingGroup,
  listManagedWorkingGroups,
  listMembers,
  listPendingMembershipRequests,
  listWorkingGroupDirectory,
  normalizeEmailList,
  updateWorkingGroup,
  type Db,
  type QueueMail,
} from "@padvinder/db";
import type { Mailer } from "@padvinder/mail";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { mapAdminErrors } from "../admin-errors";
import { apiError, errorResponses } from "../errors";
import { authorize, decide } from "../permissions/rules";
import { sendRequestDecidedMail } from "../mail/request-decided-mail";
import { toMembershipRequestForReview } from "../serializers/membership-requests";

const workingGroupParamsSchema = z.object({ workingGroupId: z.uuid() });

/** The most people one account adds or invites in 24 hours. */
const MAX_ADDITIONS_PER_DAY = 500;

export const workingGroupRoutes: FastifyPluginAsyncZod<{
  db: Db;
  mailer: Mailer;
  queueMail: QueueMail;
  /** The origin of the links in mails (`PUBLIC_ORIGIN`). */
  publicOrigin: string;
}> = async (app, { db, mailer, queueMail, publicOrigin }) => {
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

  app.post(
    "/working-groups/:workingGroupId/members",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "addMembers",
        summary:
          "Add people to a working group by email address (its coordinators, the admins of its organization and platform admins). One outcome per address; the same list again changes nothing",
        params: workingGroupParamsSchema,
        body: addMembersRequestSchema,
        response: {
          200: addMembersResponseSchema,
          ...errorResponses(400, 401, 403, 404, 429),
        },
      },
    },
    async (request): Promise<AddMembersResponse> => {
      const actor = request.actor!;
      const group = await getWorkingGroup(db, request.params.workingGroupId);
      if (!group) throw apiError(404, apiErrorCodes.notFound, "Not found");
      authorize(actor, {
        action: "workingGroup.addMembers",
        target: { workingGroupId: group.workingGroupId, organizationId: group.organizationId },
      });
      // Both limits are checked before the first address, so a refused list changes nothing.
      const addresses = normalizeEmailList(request.body.emails);
      if (addresses.length > MAX_ADDRESSES_PER_REQUEST) {
        throw apiError(
          429,
          apiErrorCodes.tooManyAddresses,
          `At most ${MAX_ADDRESSES_PER_REQUEST} addresses per request`,
        );
      }
      const now = new Date();
      const allowed =
        MAX_ADDITIONS_PER_DAY - (await countAdditionsInLastDay(db, actor.userId, now));
      if (addresses.length > allowed) {
        throw apiError(
          429,
          apiErrorCodes.tooManyAdditions,
          `At most ${MAX_ADDITIONS_PER_DAY} people may be added in 24 hours`,
        );
      }
      // Each address commits on its own: an error partway leaves the earlier ones added, and sending
      // the same list again is safe (they answer `already_member` or `invited` without a second mail).
      const results: AddMembersResponse["results"] = [];
      for (const email of addresses) {
        const result = await mapAdminErrors(() =>
          addMemberByEmail(
            db,
            { workingGroupId: group.workingGroupId, email, addedBy: actor.userId, now },
            { queueMail },
          ),
        );
        if (result.approvedRequest) {
          sendRequestDecidedMail(
            { mailer, log: request.log, publicOrigin },
            result.approvedRequest,
          );
        }
        // Never `approvedRequest`: it holds the applicant's name and contact details.
        results.push({ email: result.email, outcome: result.outcome });
      }
      return { results };
    },
  );

  // Every logged-in user may ask: the list holds only the groups the actor manages.
  app.get(
    "/managed-working-groups",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listManagedWorkingGroups",
        summary:
          "The working groups you manage, with counts: all for a platform admin, those of your organizations for an admin, the ones you coordinate for a coordinator",
        response: { 200: managedWorkingGroupListResponseSchema, ...errorResponses(401) },
      },
    },
    async (request): Promise<ManagedWorkingGroupListResponse> => ({
      workingGroups: await listManagedWorkingGroups(db, request.actor!),
    }),
  );

  app.patch(
    "/working-groups/:workingGroupId",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "updateWorkingGroup",
        summary:
          "Change the name, the city or whether the group is active (admins of its organization and platform admins). Saving without a change is 200 too",
        params: workingGroupParamsSchema,
        body: updateWorkingGroupRequestSchema,
        response: { 200: managedWorkingGroupSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request): Promise<ManagedWorkingGroup> => {
      const actor = request.actor!;
      // A group that does not exist is the same 404 an outsider gets.
      const group = await getWorkingGroup(db, request.params.workingGroupId);
      if (!group) throw apiError(404, apiErrorCodes.notFound, "Not found");
      authorize(actor, {
        action: "workingGroup.manage",
        target: { workingGroupId: group.workingGroupId, organizationId: group.organizationId },
      });
      await mapAdminErrors(() =>
        updateWorkingGroup(
          db,
          { workingGroupId: group.workingGroupId, patch: request.body },
          { kind: "user", userId: actor.userId },
        ),
      );
      const changed = await getManagedWorkingGroup(db, group.workingGroupId);
      if (!changed) throw apiError(404, apiErrorCodes.notFound, "Not found");
      return changed;
    },
  );
};
