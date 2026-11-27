import { z } from "zod";
import { membershipRequestSchema } from "./membership-requests";
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
      /** Whether the person has made a passkey. */
      hasPasskey: z.boolean(),
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
    /**
     * The user's open request: the newest pending one (by arrival at the server). When there is
     * none, the newest request if it was rejected; otherwise `null`. The app shows the waiting
     * screen or the rejection from it.
     */
    membershipRequest: membershipRequestSchema.nullable(),
    /**
     * Until when this session counts as confirmed by a passkey (ISO 8601 with an offset), for an
     * admin; null for everyone else and for an admin who is not confirmed.
     */
    adminConfirmedUntil: z.iso.datetime({ offset: true }).nullable(),
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
