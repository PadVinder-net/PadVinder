import { z } from "zod";
import { apiErrorSchema } from "./errors";

/**
 * Why the user cannot delete their own account: they are the only coordinator of an active
 * working group, or the only admin of an organization. `workingGroupName` is filled for a
 * coordinator only. `contactEmail` is the organization's contact address, the one to ask.
 */
export const accountDeletionBlockerSchema = z
  .object({
    role: z.enum(["coordinator", "organizationAdmin"]),
    workingGroupName: z.string().nullable(),
    organizationName: z.string(),
    contactEmail: z.string().nullable(),
  })
  .meta({ id: "AccountDeletionBlocker" });
export type AccountDeletionBlocker = z.infer<typeof accountDeletionBlockerSchema>;

/**
 * The 409 of `DELETE /api/me`. A blocked deletion (`last_coordinator` or
 * `last_organization_admin`) lists every `blockers`: one per working group, then one per
 * organization. Other conflicts (`last_platform_admin`) leave the key out.
 */
export const accountDeletionBlockedSchema = apiErrorSchema
  .extend({ blockers: z.array(accountDeletionBlockerSchema).optional() })
  .meta({ id: "AccountDeletionBlocked" });
export type AccountDeletionBlocked = z.infer<typeof accountDeletionBlockedSchema>;
