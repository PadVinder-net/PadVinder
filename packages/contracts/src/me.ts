import { z } from "zod";
import { workingGroupSummarySchema } from "./working-groups";

export const meResponseSchema = z
  .object({
    user: z.object({
      id: z.string(),
      /** Empty until the person has given it. */
      name: z.string(),
      email: z.string(),
      phone: z.string().nullable(),
      isPlatformAdmin: z.boolean(),
    }),
    memberships: z.array(
      z.object({
        id: z.string(),
        /** Every member is a volunteer; a coordinator is one too, with this flag set. */
        isCoordinator: z.boolean(),
        workingGroup: workingGroupSummarySchema,
      }),
    ),
    organizationAdminOf: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  .meta({ id: "MeResponse" });
export type MeResponse = z.infer<typeof meResponseSchema>;

/** A `PATCH` body: present keys change, absent keys stay, `null` clears the phone. */
export const updateMeRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    phone: z
      .string()
      .trim()
      .max(30)
      .transform((phone) => (phone === "" ? null : phone))
      // Gives the output side of the OpenAPI component a type; a transform alone has none.
      .pipe(z.string().nullable())
      .nullable()
      .optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one field",
  })
  .meta({ id: "UpdateMeRequest" });
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;
