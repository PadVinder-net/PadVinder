import { z } from "zod";
import { emailAddressSchema } from "./email";

/**
 * An account as a platform admin sees it before deleting it: who it is, and what it holds
 * together. `workingGroups` holds every membership, also of a working group that is switched off
 * (the deletion removes those too). No phone number: the question before deleting needs none.
 */
export const accountSummarySchema = z
  .object({
    id: z.string(),
    /** Empty until the person has chosen a name. */
    name: z.string(),
    email: z.string(),
    hasLoggedIn: z.boolean(),
    isPlatformAdmin: z.boolean(),
    organizationAdminOf: z.array(z.object({ id: z.string(), name: z.string() })),
    workingGroups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        organization: z.object({ id: z.string(), name: z.string() }),
        isCoordinator: z.boolean(),
      }),
    ),
  })
  .meta({ id: "AccountSummary" });
export type AccountSummary = z.infer<typeof accountSummarySchema>;

/**
 * The address to look up, in the body so it never reaches a request log. It must be the whole
 * address: the lookup compares it as equal, never as a part.
 */
export const findAccountRequestSchema = z
  .strictObject({ email: emailAddressSchema })
  .meta({ id: "FindAccountRequest" });
export type FindAccountRequest = z.infer<typeof findAccountRequestSchema>;
