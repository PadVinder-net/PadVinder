import { z } from "zod";

/** The domain of the address a deleted account gets (`deletedAccountEmail` in `@padvinder/db`). */
export const DELETED_ACCOUNT_EMAIL_DOMAIN = "deleted.invalid";

/**
 * An email address someone types into an administration form: surrounding spaces are removed and
 * capitals lowered before it is checked, so sloppy typing reaches the same account. At most 254
 * characters. The replaced address of a deleted account is refused: it never gets a role again.
 *
 * The normalizing comes before a `pipe`, so the request side of the OpenAPI description is a plain
 * string (spaces and capitals are allowed there) and the parsed side is an email address.
 */
export const emailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email()
      .max(254)
      .refine((address) => !address.endsWith(`@${DELETED_ACCOUNT_EMAIL_DOMAIN}`), {
        message: "The address of a deleted account cannot be used",
      }),
  );

/** Whether the text is an email address by the rule of `emailAddressSchema`. */
export function isEmailAddress(text: string): boolean {
  return emailAddressSchema.safeParse(text).success;
}
