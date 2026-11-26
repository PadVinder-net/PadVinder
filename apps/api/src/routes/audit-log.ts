import {
  auditLogPageSchema,
  listAuditLogEntriesQuerySchema,
  type AuditLogPage,
} from "@padvinder/contracts";
import { listAuditLogEntries, type Db } from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponses } from "../errors";
import { authorize } from "../permissions/rules";

/**
 * Reads the audit log. Without `organizationId` the page is scoped to what the actor administers
 * (everything for a platform admin, empty for anyone else), as `GET /api/organizations` is. With
 * one, the actor must be allowed to read that organization's log: everyone else, also for an ID no
 * organization has, gets 404. Who is shown by name is decided in `listAuditLogEntries`.
 */
export const auditLogRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/audit-log-entries",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listAuditLogEntries",
        summary:
          "One page of the audit log, newest first: all for a platform admin, the entries of the organizations you administer for an organization admin, empty for others",
        querystring: listAuditLogEntriesQuerySchema,
        response: { 200: auditLogPageSchema, ...errorResponses(400, 401, 403, 404) },
      },
    },
    async (request): Promise<AuditLogPage> => {
      const actor = request.actor!;
      const { organizationId } = request.query;
      if (organizationId !== undefined) {
        // The organization first: reads only the actor, so another organization stays 404 for an
        // unconfirmed organization admin, and their own gives passkey_required.
        authorize(actor, { action: "organization.readAuditLog", target: { organizationId } });
      }
      authorize(actor, { action: "admin.listAdministered" });
      return listAuditLogEntries(db, actor, request.query);
    },
  );
};
