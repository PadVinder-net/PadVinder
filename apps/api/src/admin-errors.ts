import { apiErrorCodes } from "@padvinder/contracts";
import type { AdminError } from "@padvinder/db";
import { apiError, type ApiError } from "./errors";

/**
 * The API answer for an error of an administration function (`packages/db/src/admin.ts`).
 * `fields.email` names the request field that holds the address (default `email`), so the issue
 * points at it. `working_group_inactive` cannot come from a route that checks first: it is
 * rethrown, so a test sees a 500 and the mistake is found.
 */
export function adminErrorToApiError(error: AdminError, fields: { email?: string } = {}): ApiError {
  const emailField = fields.email ?? "email";
  switch (error.code) {
    case "organization_not_found":
    case "working_group_not_found":
    case "membership_not_found":
      return apiError(404, apiErrorCodes.notFound, "Not found");
    case "invalid_email":
      return apiError(400, apiErrorCodes.invalidRequest, "Not an email address", [
        { path: emailField, message: "Not an email address" },
      ]);
    case "user_not_found":
      return apiError(400, apiErrorCodes.invalidRequest, "No account can have this address", [
        { path: emailField, message: "No account can have this address" },
      ]);
    case "name_taken":
      return apiError(409, apiErrorCodes.nameTaken, "Another record has this name", [
        { path: "name", message: "Another record has this name, in any capitals" },
      ]);
    case "person_outside_organization":
      return apiError(
        409,
        apiErrorCodes.personOutsideOrganization,
        "This person has an account outside the organization",
        [{ path: emailField, message: "This person has an account outside the organization" }],
      );
    case "last_organization_admin":
      return apiError(
        409,
        apiErrorCodes.lastOrganizationAdmin,
        "An organization always has an admin",
      );
    case "last_coordinator":
      return apiError(
        409,
        apiErrorCodes.lastCoordinator,
        "An active working group always has a coordinator",
      );
    case "no_coordinator":
      return apiError(409, apiErrorCodes.noCoordinator, "This working group has no coordinator");
    case "last_platform_admin":
      return apiError(409, apiErrorCodes.lastPlatformAdmin, "There is always a platform admin");
    case "working_group_inactive":
      throw error;
    default: {
      const unreachable: never = error.code;
      throw new Error(`Unknown admin error ${String(unreachable)}`);
    }
  }
}
