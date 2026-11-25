import { z } from "zod";
import { emailAddressSchema } from "./email";

/** An organization, as its administrators see it. */
export const organizationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** Where a coordinator or applicant can ask for help; `null` when there is none. */
    contactEmail: z.string().nullable(),
  })
  .meta({ id: "Organization" });
export type Organization = z.infer<typeof organizationSchema>;

export const organizationAdminSchema = z
  .object({
    userId: z.string(),
    /** Empty until the person has chosen a name. */
    name: z.string(),
    email: z.string(),
    /** False for an account made by the administration, until the person logs in. */
    hasLoggedIn: z.boolean(),
  })
  .meta({ id: "OrganizationAdmin" });
export type OrganizationAdmin = z.infer<typeof organizationAdminSchema>;

export const organizationDetailSchema = organizationSchema
  .extend({ admins: z.array(organizationAdminSchema) })
  .meta({ id: "OrganizationDetail" });
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;

export const organizationListResponseSchema = z
  .object({ organizations: z.array(organizationSchema) })
  .meta({ id: "OrganizationListResponse" });
export type OrganizationListResponse = z.infer<typeof organizationListResponseSchema>;

/**
 * An organization name: trimmed, 1 to 100 characters. The server also turns every run of
 * whitespace into one space. An `@` is refused: the audit log refuses text with one.
 */
export const organizationNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((name) => !name.includes("@"), { message: "A name cannot contain @" });

export const createOrganizationRequestSchema = z
  .strictObject({
    name: organizationNameSchema,
    /** The first admin. An address without an account gets one. */
    adminEmail: emailAddressSchema,
    contactEmail: emailAddressSchema.nullable().optional(),
  })
  .meta({ id: "CreateOrganizationRequest" });
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;

/** A `PATCH` body: present keys change, absent keys stay, `null` empties the contact address. */
export const updateOrganizationRequestSchema = z
  .strictObject({
    name: organizationNameSchema.optional(),
    contactEmail: emailAddressSchema.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one field",
  })
  .meta({ id: "UpdateOrganizationRequest" });
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;

export const addOrganizationAdminRequestSchema = z
  .strictObject({ email: emailAddressSchema })
  .meta({ id: "AddOrganizationAdminRequest" });
export type AddOrganizationAdminRequest = z.infer<typeof addOrganizationAdminRequestSchema>;
