import {
  apiErrorCodes,
  apiErrorSchema,
  type ApiErrorBody,
  type ApiErrorCode,
} from "@padvinder/contracts";
import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

const REASONS: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

const reasonFor = (statusCode: number): string => REASONS[statusCode] ?? "Error";

/** An error a route throws on purpose. It becomes the response body as is. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiError(statusCode: number, code: ApiErrorCode, message: string): ApiError {
  return new ApiError(statusCode, code, message);
}

/** The body of an error response, for code that replies without throwing (hooks). */
export function apiErrorBody(
  statusCode: number,
  code: ApiErrorCode,
  message: string,
): ApiErrorBody {
  return { statusCode, error: reasonFor(statusCode), message, code };
}

/** For a route's `schema.response`: `response: { 200: ..., ...errorResponses(400, 401) }`. */
export function errorResponses(...statusCodes: number[]): Record<number, typeof apiErrorSchema> {
  return Object.fromEntries(statusCodes.map((statusCode) => [statusCode, apiErrorSchema]));
}

function codeForStatus(statusCode: number): ApiErrorCode {
  switch (statusCode) {
    case 401:
      return apiErrorCodes.notLoggedIn;
    case 403:
      return apiErrorCodes.notAllowed;
    case 404:
      return apiErrorCodes.notFound;
    case 429:
      return apiErrorCodes.tooManyRequests;
    default:
      return apiErrorCodes.invalidRequest;
  }
}

function issuePath(instancePath: string): string {
  return instancePath.split("/").filter(Boolean).join(".");
}

/**
 * Sets the error handler (one body shape for every error) and the not-found handler for
 * paths under `/api`. Other unknown paths keep the handler of the static apps.
 */
export function addErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      return reply
        .code(error.statusCode)
        .send(apiErrorBody(error.statusCode, error.code, error.message));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const body: ApiErrorBody = {
        ...apiErrorBody(400, apiErrorCodes.invalidRequest, error.message),
        issues: error.validation.map((issue) => ({
          path: issuePath(issue.instancePath),
          message: issue.message ?? "Invalid",
        })),
      };
      return reply.code(400).send(body);
    }
    const statusCode = "statusCode" in error ? error.statusCode : undefined;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply
        .code(statusCode)
        .send(apiErrorBody(statusCode, codeForStatus(statusCode), error.message));
    }
    request.log.error({ err: error }, "Unexpected error");
    return reply
      .code(500)
      .send(apiErrorBody(500, apiErrorCodes.internalError, "Internal server error"));
  });

  // A scope with its own prefix, so the static apps can keep the root not-found handler.
  void app.register(
    async (scope) => {
      scope.setNotFoundHandler((request, reply) => {
        const path = request.url.split("?")[0] ?? "";
        return reply
          .code(404)
          .send(
            apiErrorBody(404, apiErrorCodes.notFound, `Route ${request.method}:${path} not found`),
          );
      });
    },
    { prefix: "/api" },
  );
}
