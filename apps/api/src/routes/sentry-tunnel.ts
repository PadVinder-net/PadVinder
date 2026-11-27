import { apiErrorCodes } from "@padvinder/contracts";
import {
  forwardEnvelope,
  prepareBrowserEnvelope,
  type MonitoringSettings,
} from "@padvinder/monitoring";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiError, errorResponses } from "../errors";
import { clientAddress } from "../rate-limit/client-address";
import { createWindowLimiter, type WindowLimiter } from "../rate-limit/window-limiter";

/** The largest envelope the tunnel takes; the browser sends no attachments or replays. */
export const SENTRY_TUNNEL_BODY_LIMIT = 200 * 1024;
/** Envelopes per client address per minute (`clientAddress`). */
export const SENTRY_TUNNEL_LIMIT = { max: 120, windowMs: 60_000 };

export type SentryTunnelOptions = {
  /** Sentry is off without a browser DSN: the tunnel then answers 204 and drops every envelope. */
  monitoring: MonitoringSettings | undefined;
  /** Tests. Default: `SENTRY_TUNNEL_LIMIT`, in this process's memory. */
  limiter?: WindowLimiter;
};

/**
 * `POST /sentry-tunnel`: the browser SDK's `tunnel`. Takes an envelope without a login, makes it
 * fit with `prepareBrowserEnvelope` (only our item types, scrubbed, our DSN and environment, the
 * browser's release when it is a full commit, else ours) and forwards it to
 * `SENTRY_BROWSER_DSN`'s ingest address with none of the phone's headers.
 * Sentry's answer comes back for 2xx and 429 (with its rate limit headers, which the SDK obeys),
 * 502 for anything else.
 */
export const sentryTunnelRoutes: FastifyPluginAsyncZod<SentryTunnelOptions> = async (
  app,
  options,
) => {
  const limiter = options.limiter ?? createWindowLimiter(SENTRY_TUNNEL_LIMIT);
  const settings = options.monitoring;

  // This plugin's scope only: the body is the raw envelope, whatever the content type the SDK's
  // fetch sets (`text/plain;charset=UTF-8` for a string body) and also without one.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  app.post(
    "/sentry-tunnel",
    {
      bodyLimit: SENTRY_TUNNEL_BODY_LIMIT,
      schema: {
        // Not in openapi.json or the generated client: the browser SDK is its only caller.
        hide: true,
        operationId: "forwardSentryEnvelope",
        summary: "Forward an envelope of the browser SDK to Sentry, scrubbed",
        description:
          "The body is a Sentry envelope (newline-delimited JSON). For the browser SDK only; the generated client does not use it.",
        response: {
          200: z.null(),
          204: z.null(),
          ...errorResponses(400, 403, 413, 429, 502),
        },
      },
      // Before the body is read, so a refused sender costs no parsing.
      onRequest: async (request) => {
        if (!limiter.take(clientAddress(request))) {
          throw apiError(
            429,
            apiErrorCodes.tooManyRequests,
            "Too many envelopes from this address",
          );
        }
      },
    },
    async (request, reply) => {
      if (settings?.browserDsn === undefined) return reply.code(204).send(null);
      const body = request.body;
      const envelope =
        body instanceof Uint8Array
          ? prepareBrowserEnvelope(body, { ...settings, dsn: settings.browserDsn })
          : null;
      if (envelope === null) {
        throw apiError(400, apiErrorCodes.invalidRequest, "The body is not a Sentry envelope");
      }
      const result = await forwardEnvelope(envelope, settings.browserDsn);
      if (
        result.status === "unreachable" ||
        (result.status !== 429 && (result.status < 200 || result.status > 299))
      ) {
        request.log.warn(
          {
            sentryStatus: result.status,
            // Sentry's own reason (scrubbed), or why no answer came: what a 403 or 502 means.
            sentryAnswer: result.status === "unreachable" ? result.reason : result.detail,
          },
          "Sentry did not take a browser envelope",
        );
        throw apiError(502, apiErrorCodes.sentryUnavailable, "Sentry did not take the envelope");
      }
      if (result.retryAfter !== undefined) reply.header("retry-after", result.retryAfter);
      if (result.rateLimits !== undefined) reply.header("x-sentry-rate-limits", result.rateLimits);
      if (result.status === 429) {
        throw apiError(429, apiErrorCodes.tooManyRequests, "Sentry's rate limit");
      }
      // Sentry answers 200; another 2xx passes on the same way, with no body.
      return reply.code(result.status as 200).send(null);
    },
  );
};
