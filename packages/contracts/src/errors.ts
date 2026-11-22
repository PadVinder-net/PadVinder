import { z } from "zod";

/** The stable identifiers in `ApiError.code`. The apps choose their Dutch text from these. */
export const apiErrorCodes = {
  invalidRequest: "invalid_request",
  notLoggedIn: "not_logged_in",
  notAllowed: "not_allowed",
  notFound: "not_found",
  originNotAllowed: "origin_not_allowed",
  tooManyRequests: "too_many_requests",
  /** The client-generated ID belongs to a record of someone else. */
  idInUse: "id_in_use",
  alreadyMember: "already_member",
  alreadyRequested: "already_requested",
  alreadyDecided: "already_decided",
  /** The membership changed (made coordinator, or no longer) while the request was being handled. */
  membershipChanged: "membership_changed",
  internalError: "internal_error",
} as const;
export type ApiErrorCode = (typeof apiErrorCodes)[keyof typeof apiErrorCodes];

/** Fastify's `statusCode`, `error` and `message`, plus `code`. `message` is for developers. */
export const apiErrorSchema = z
  .object({
    statusCode: z.number().int(),
    error: z.string(),
    message: z.string(),
    code: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: "ApiError" });
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
