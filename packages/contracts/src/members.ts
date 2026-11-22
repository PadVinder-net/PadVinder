import { z } from "zod";

/**
 * A member of a working group. `email` and `phone` are only there for a coordinator of the group,
 * an admin of its organization or a platform admin; for everyone else the keys are left out.
 */
export const memberSchema = z
  .object({
    membershipId: z.string(),
    userId: z.string(),
    /** Empty when the person has not given it yet. */
    name: z.string(),
    /** Every member is a volunteer; a coordinator is one too, with this flag set. */
    isCoordinator: z.boolean(),
    email: z.string().optional(),
    phone: z.string().nullable().optional(),
  })
  .meta({ id: "Member" });
export type Member = z.infer<typeof memberSchema>;

/** The members of one working group, sorted by name. */
export const memberListResponseSchema = z
  .object({ members: z.array(memberSchema) })
  .meta({ id: "MemberListResponse" });
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;
