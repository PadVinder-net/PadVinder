import { z } from "zod";
import { emailAddressSchema } from "./email";

/** A platform admin, as other platform admins see them. */
export const platformAdminSchema = z
  .object({
    userId: z.string(),
    /** Empty until the person has chosen a name. */
    name: z.string(),
    email: z.string(),
    /** False for an account made by appointing it, until the person logs in. */
    hasLoggedIn: z.boolean(),
  })
  .meta({ id: "PlatformAdmin" });
export type PlatformAdmin = z.infer<typeof platformAdminSchema>;

export const platformAdminListResponseSchema = z
  .object({ platformAdmins: z.array(platformAdminSchema) })
  .meta({ id: "PlatformAdminListResponse" });
export type PlatformAdminListResponse = z.infer<typeof platformAdminListResponseSchema>;

/** An address without an account gets one. */
export const addPlatformAdminRequestSchema = z
  .strictObject({ email: emailAddressSchema })
  .meta({ id: "AddPlatformAdminRequest" });
export type AddPlatformAdminRequest = z.infer<typeof addPlatformAdminRequestSchema>;
