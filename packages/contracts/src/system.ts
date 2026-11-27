import { z } from "zod";

/** What one try to reach Sentry over one address family gave. */
export const sentryConnectionResultSchema = z
  .object({
    family: z.union([z.literal(4), z.literal(6)]),
    /** Sentry's HTTP status (or its front end's), or `unreachable` when no answer came. */
    status: z.union([z.number().int(), z.literal("unreachable")]),
    /**
     * For a refusal: the HTML page's title or the start of the answer. For `unreachable`: the
     * network error's code (`ENETUNREACH`, `ENOTFOUND`, …) or `TimeoutError`.
     */
    answer: z.string().optional(),
  })
  .meta({ id: "SentryConnectionResult" });
export type SentryConnectionResult = z.infer<typeof sentryConnectionResultSchema>;

/**
 * `POST /api/system/sentry-connection-test`: with `sentryOff` (no `SENTRY_DSN`) nothing was sent
 * and `results` is empty; otherwise one result for IPv4, then one for IPv6.
 */
export const sentryConnectionTestResponseSchema = z
  .object({
    sentryOff: z.boolean(),
    results: z.array(sentryConnectionResultSchema),
  })
  .meta({ id: "SentryConnectionTestResponse" });
export type SentryConnectionTestResponse = z.infer<typeof sentryConnectionTestResponseSchema>;
