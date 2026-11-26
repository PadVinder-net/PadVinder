import { z } from "zod";

/**
 * A problem report from the app or the portal ("Meld een probleem"). Strict: the name and address
 * never come from the body, only from the profile of whoever sends it, and only with
 * `includeContact`.
 */
export const problemReportRequestSchema = z
  .strictObject({
    /** What went wrong, in the user's words. */
    message: z.string().trim().min(1).max(2000),
    /** Send the name and address of the profile along, so the makers can mail back. */
    includeContact: z.boolean(),
    /** The Sentry event ID of the crash the report is about, from the crash screen. */
    eventId: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
    /** The path the user was on. */
    page: z.string().max(500),
    appVersion: z.string().max(40),
    app: z.enum(["app", "portal"]),
  })
  .meta({ id: "ProblemReportRequest" });
export type ProblemReportRequest = z.infer<typeof problemReportRequestSchema>;
