import { sentryConnectionTestResponseSchema } from "@padvinder/contracts";
import type { Db } from "@padvinder/db";
import { testSentryConnection, type MonitoringSettings } from "@padvinder/monitoring";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponses } from "../errors";
import { authorize } from "../permissions/rules";

export type SystemRouteOptions = {
  db: Db;
  /** Sentry is off without a DSN: the connection test then sends nothing. */
  monitoring: MonitoringSettings | undefined;
};

export const systemRoutes: FastifyPluginAsyncZod<SystemRouteOptions> = async (
  app,
  { db, monitoring },
) => {
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

  /**
   * `POST /api/system/sentry-connection-test`: a platform admin checks whether this server reaches
   * Sentry's ingest over IPv4 and over IPv6, with one plain test event over each (in parallel,
   * against `SENTRY_DSN`). The answer holds each status and why a try was refused or got no
   * answer, never the DSN or its key. Not traced (`tracesSampler`).
   */
  app.post(
    "/system/sentry-connection-test",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "testSentryConnection",
        summary: "Send a test event to Sentry over IPv4 and over IPv6 (platform admins)",
        response: { 200: sentryConnectionTestResponseSchema, ...errorResponses(401, 403) },
      },
    },
    async (request) => {
      authorize(request.actor!, { action: "system.testSentryConnection" });
      const dsn = monitoring?.dsn;
      if (dsn === undefined) return { sentryOff: true, results: [] };
      const results = await Promise.all(
        ([4, 6] as const).map((family) => testSentryConnection(dsn, family, { service: "api" })),
      );
      request.log.info({ sentryConnection: results }, "Sentry connection test");
      return { sentryOff: false, results };
    },
  );
};
