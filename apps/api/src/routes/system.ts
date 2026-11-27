import type { Db } from "@padvinder/db";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponses } from "../errors";
import { authorize } from "../permissions/rules";

export type SystemRouteOptions = { db: Db };

export const systemRoutes: FastifyPluginAsyncZod<SystemRouteOptions> = async (app, { db }) => {
  /**
   * `POST /api/system/test-error`: a platform admin checks that errors reach Sentry. It queries the
   * database first, so the trace has a database span, then throws, so the answer is 500
   * `internal_error` and the error becomes one Sentry issue.
   */
  app.post(
    "/system/test-error",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "triggerTestError",
        summary: "Throw a test error, to check error reporting (platform admins)",
        response: { ...errorResponses(401, 403, 500) },
      },
    },
    async (request) => {
      authorize(request.actor!, { action: "system.triggerTestError" });
      await db.execute(sql`select 1`);
      throw new Error("Test error requested by a platform admin");
    },
  );
};
