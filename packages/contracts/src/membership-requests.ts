import { z } from "zod";
import { workingGroupSummarySchema } from "./working-groups";

const timestampSchema = z.iso.datetime({ offset: true });

export const membershipRequestStatusSchema = z
  .enum(["pending", "approved", "rejected", "withdrawn"])
  .meta({ id: "MembershipRequestStatus" });
export type MembershipRequestStatus = z.infer<typeof membershipRequestStatusSchema>;

/**
 * Asking to join a working group (glossary: aanmelding). The app makes `id` once, when the user
 * taps, and sends the same `id` on every resend: it is the idempotency key. `requestedAt` is
 * when the user acted, by the phone's clock.
 */
export const createMembershipRequestSchema = z
  .object({
    id: z.uuidv7(),
    workingGroupId: z.uuid(),
    requestedAt: timestampSchema,
  })
  .meta({ id: "CreateMembershipRequest" });
export type CreateMembershipRequest = z.infer<typeof createMembershipRequestSchema>;

export const membershipRequestSchema = z
  .object({
    id: z.string(),
    status: membershipRequestStatusSchema,
    requestedAt: timestampSchema,
    /** When it was approved, rejected or withdrawn; `null` while pending. */
    decidedAt: timestampSchema.nullable(),
    workingGroup: workingGroupSummarySchema,
  })
  .meta({ id: "MembershipRequest" });
export type MembershipRequest = z.infer<typeof membershipRequestSchema>;
