import { z } from "zod";

/**
 * A member of a working group. `email`, `phone` and `hasLoggedIn` are only there for a coordinator of the group,
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
    /** Whether the person has ever logged in. Only there together with `email`. */
    hasLoggedIn: z.boolean().optional(),
  })
  .meta({ id: "Member" });
export type Member = z.infer<typeof memberSchema>;

/** The members of one working group, sorted by name. */
export const memberListResponseSchema = z
  .object({
    members: z.array(memberSchema),
    /**
     * Fields left out of every member because a passkey confirmation would show them. Absent when
     * nothing is hidden for that reason.
     */
    passkeyReveals: z.array(z.enum(["email", "phone", "hasLoggedIn"])).optional(),
  })
  .meta({ id: "MemberListResponse" });
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;
