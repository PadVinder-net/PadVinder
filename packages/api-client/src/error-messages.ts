import {
  accountDeletionBlockedSchema,
  apiErrorSchema,
  type AccountDeletionBlocker,
} from "@padvinder/contracts";

/**
 * The stable `code` of an error the generated client threw, when it is our API's error body.
 * `null` for a network failure (the request never got an answer), a proxy's page during a deploy,
 * or anything else. The Dutch text for it is `apiErrorMessage` in `@padvinder/ui`.
 */
export function apiErrorCode(error: unknown): string | null {
  const parsed = apiErrorSchema.safeParse(error);
  return parsed.success ? parsed.data.code : null;
}

/**
 * The `issues` of an error the generated client threw, when it is our API's error body: which
 * field (`path`) a validation or conflict error is about. An empty list for anything else.
 */
export function apiErrorIssues(error: unknown): { path: string; message: string }[] {
  const parsed = apiErrorSchema.safeParse(error);
  return parsed.success ? (parsed.data.issues ?? []) : [];
}

/**
 * The `blockers` of a refused `DELETE /api/me`: the working groups the user is the only
 * coordinator of, then the organizations they are the only admin of. An empty list for any other
 * error. The Dutch text for one is `accountDeletionBlockedMessage` in `@padvinder/ui`.
 */
export function accountDeletionBlockers(error: unknown): AccountDeletionBlocker[] {
  const parsed = accountDeletionBlockedSchema.safeParse(error);
  return parsed.success ? (parsed.data.blockers ?? []) : [];
}
