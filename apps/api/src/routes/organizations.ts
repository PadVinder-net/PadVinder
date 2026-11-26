import {
  addOrganizationAdminRequestSchema,
  apiErrorCodes,
  createOrganizationRequestSchema,
  createWorkingGroupRequestSchema,
  managedWorkingGroupSchema,
  organizationDetailSchema,
  organizationListResponseSchema,
  updateOrganizationRequestSchema,
  type ManagedWorkingGroup,
  type OrganizationDetail,
  type OrganizationListResponse,
} from "@padvinder/contracts";
import {
  createOrganization,
  createWorkingGroup,
  getManagedWorkingGroup,
  getOrganization,
  grantOrganizationAdmin,
  listAdministeredOrganizations,
  removeOrganizationAdmin,
  updateOrganization,
  type Db,
  type QueueMail,
} from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { mapAdminErrors } from "../admin-errors";
import { apiError, errorResponses } from "../errors";
import { authorize } from "../permissions/rules";

const organizationParamsSchema = z.object({ organizationId: z.uuid() });
const adminParamsSchema = z.object({ organizationId: z.uuid(), userId: z.uuid() });

/**
 * Organizations and their admins. The list is scoped to what the actor administers; one
 * organization is seen by its admins and by platform admins, and everyone else gets 404.
 * Appointing an admin or a first coordinator queues a mail to them (`queueMail`).
 */
export const organizationRoutes: FastifyPluginAsyncZod<{ db: Db; queueMail: QueueMail }> = async (
  app,
  { db, queueMail },
) => {
  const detail = async (organizationId: string): Promise<OrganizationDetail> => {
    const organization = await getOrganization(db, organizationId);
    if (!organization) throw apiError(404, apiErrorCodes.notFound, "Organization not found");
    return organization;
  };

  app.get(
    "/organizations",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listOrganizations",
        summary: "The organizations you administer: all for a platform admin, none for others",
        response: { 200: organizationListResponseSchema, ...errorResponses(401) },
      },
    },
    async (request): Promise<OrganizationListResponse> => ({
      organizations: await listAdministeredOrganizations(db, request.actor!),
    }),
  );

  app.get(
    "/organizations/:organizationId",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "getOrganization",
        summary: "One organization with its admins",
        params: organizationParamsSchema,
        response: { 200: organizationDetailSchema, ...errorResponses(400, 401, 404) },
      },
    },
    async (request): Promise<OrganizationDetail> => {
      const { organizationId } = request.params;
      authorize(request.actor!, { action: "organization.view", target: { organizationId } });
      return detail(organizationId);
    },
  );

  app.post(
    "/organizations",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "createOrganization",
        summary: "Add an organization with its first admin (platform admins)",
        body: createOrganizationRequestSchema,
        response: { 201: organizationDetailSchema, ...errorResponses(400, 401, 403, 409) },
      },
    },
    async (request, reply): Promise<OrganizationDetail> => {
      const actor = request.actor!;
      authorize(actor, { action: "platform.manageOrganizations" });
      const created = await mapAdminErrors(
        () =>
          createOrganization(
            db,
            request.body,
            { kind: "user", userId: actor.userId },
            { queueMail },
          ),
        { email: "adminEmail" },
      );
      reply.code(201);
      return detail(created.id);
    },
  );

  app.patch(
    "/organizations/:organizationId",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "updateOrganization",
        summary:
          "Change the contact address (its admins) or the name (platform admins). Saving without a change is 200 too",
        params: organizationParamsSchema,
        body: updateOrganizationRequestSchema,
        response: { 200: organizationDetailSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request): Promise<OrganizationDetail> => {
      const actor = request.actor!;
      const { organizationId } = request.params;
      const target = { organizationId };
      // Both are decided before anything changes: a body with a name from an admin changes nothing.
      authorize(actor, { action: "organization.changeContact", target });
      if (request.body.name !== undefined)
        authorize(actor, { action: "organization.rename", target });
      await mapAdminErrors(
        () =>
          updateOrganization(
            db,
            { organizationId, patch: request.body },
            { kind: "user", userId: actor.userId },
          ),
        { email: "contactEmail" },
      );
      return detail(organizationId);
    },
  );

  app.post(
    "/organizations/:organizationId/admins",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "addOrganizationAdmin",
        summary:
          "Make someone an admin of the organization (platform admins). Also 200 when they were",
        params: organizationParamsSchema,
        body: addOrganizationAdminRequestSchema,
        response: { 200: organizationDetailSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request): Promise<OrganizationDetail> => {
      const actor = request.actor!;
      const { organizationId } = request.params;
      authorize(actor, { action: "organization.manageAdmins", target: { organizationId } });
      await mapAdminErrors(() =>
        grantOrganizationAdmin(
          db,
          { email: request.body.email, organizationId },
          { kind: "user", userId: actor.userId },
          { queueMail },
        ),
      );
      return detail(organizationId);
    },
  );

  app.delete(
    "/organizations/:organizationId/admins/:userId",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "removeOrganizationAdmin",
        summary: "Take the admin role away (platform admins). Never the last admin",
        params: adminParamsSchema,
        response: { 204: z.null(), ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request, reply) => {
      const actor = request.actor!;
      const { organizationId, userId } = request.params;
      authorize(actor, { action: "organization.manageAdmins", target: { organizationId } });
      const { changed } = await mapAdminErrors(() =>
        removeOrganizationAdmin(
          db,
          { organizationId, userId },
          { kind: "user", userId: actor.userId },
        ),
      );
      if (!changed) throw apiError(404, apiErrorCodes.notFound, "This person is no admin there");
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/organizations/:organizationId/working-groups",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "createWorkingGroup",
        summary:
          "Add a working group with its first coordinator (admins of the organization and platform admins)",
        params: organizationParamsSchema,
        body: createWorkingGroupRequestSchema,
        response: { 201: managedWorkingGroupSchema, ...errorResponses(400, 401, 404, 409) },
      },
    },
    async (request, reply): Promise<ManagedWorkingGroup> => {
      const actor = request.actor!;
      const { organizationId } = request.params;
      authorize(actor, { action: "organization.createWorkingGroup", target: { organizationId } });
      const created = await mapAdminErrors(
        () =>
          createWorkingGroup(
            db,
            { organizationId, ...request.body },
            { kind: "user", userId: actor.userId },
            { queueMail },
          ),
        { email: "coordinatorEmail" },
      );
      const group = await getManagedWorkingGroup(db, created.id);
      if (!group) throw apiError(404, apiErrorCodes.notFound, "Working group not found");
      reply.code(201);
      return group;
    },
  );
};
