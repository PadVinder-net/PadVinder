import { apiErrorCodes, problemReportRequestSchema } from "@padvinder/contracts";
import { scrub } from "@padvinder/logging";
import {
  buildFeedbackEnvelope,
  forwardEnvelope,
  type MonitoringSettings,
} from "@padvinder/monitoring";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiError, errorResponses } from "../errors";
import { createWindowLimiter, type WindowLimiter } from "../rate-limit/window-limiter";

/** Problem reports per account per hour. */
export const PROBLEM_REPORT_LIMIT = { max: 10, windowMs: 60 * 60_000 };

export type ProblemReportOptions = {
  /** Sentry is off without a browser DSN: a report is then only logged, with its length. */
  monitoring: MonitoringSettings | undefined;
  /** Tests. Default: `PROBLEM_REPORT_LIMIT`, keyed by account ID, in this process's memory. */
  limiter?: WindowLimiter;
};

/**
 * `POST /problem-reports` ("Meld een probleem"): sends the report to Sentry as user feedback,
 * built here (`buildFeedbackEnvelope`) and posted with `forwardEnvelope`, so the answer says
 * whether Sentry took it. The message and the page go through `scrub`; the name and address come
 * only from the actor's profile, only with `includeContact`, and are the one thing not scrubbed.
 */
export const problemReportRoutes: FastifyPluginAsyncZod<ProblemReportOptions> = async (
  app,
  options,
) => {
  const limiter = options.limiter ?? createWindowLimiter(PROBLEM_REPORT_LIMIT);
  const settings = options.monitoring;

  app.post(
    "/problem-reports",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "reportProblem",
        summary: "Send a problem report to the makers (Sentry user feedback)",
        body: problemReportRequestSchema,
        response: { 204: z.null(), ...errorResponses(400, 401, 429, 502) },
      },
    },
    async (request, reply) => {
      const actor = request.actor!;
      if (!limiter.take(actor.userId)) {
        throw apiError(429, apiErrorCodes.tooManyReports, "Too many problem reports this hour");
      }
      const body = request.body;
      if (settings?.browserDsn === undefined) {
        // Never the text: it is the user's own words.
        request.log.info(
          { messageLength: body.message.length },
          "Problem report arrived; Sentry is off",
        );
        return reply.code(204).send(null);
      }
      const envelope = buildFeedbackEnvelope({
        message: scrub(body.message),
        ...(body.includeContact && {
          contact: { name: actor.user.name, email: actor.user.email },
        }),
        ...(body.eventId !== undefined && { eventId: body.eventId }),
        page: scrub(body.page),
        app: body.app,
        appVersion: scrub(body.appVersion),
        userId: actor.userId,
        dsn: settings.browserDsn,
        environment: settings.environment,
        release: settings.release,
      });
      const result = await forwardEnvelope(envelope, settings.browserDsn);
      if (result.status === "unreachable" || result.status < 200 || result.status > 299) {
        request.log.warn({ sentryStatus: result.status }, "Sentry did not take a problem report");
        throw apiError(502, apiErrorCodes.reportNotSent, "Sentry did not take the report");
      }
      return reply.code(204).send(null);
    },
  );
};
