import { z } from "zod";

/** The most addresses one request may hold (after doubles and empty ones are dropped). */
export const MAX_ADDRESSES_PER_REQUEST = 200;

/**
 * What adding one address did. `added`: a new membership for someone who never logged in.
 * `approved`: their pending request for this group was approved. `invited`: the person has an
 * account and gets a mail, no membership. `already_member`: nothing changed. `invalid`: not an
 * address.
 */
export const addMemberOutcomeSchema = z
  .enum(["added", "approved", "invited", "already_member", "invalid"])
  .meta({ id: "AddMemberOutcome" });
export type AddMemberOutcome = z.infer<typeof addMemberOutcomeSchema>;

/**
 * The texts are not checked as addresses here: a wrong one is an outcome (`invalid`), not a 400.
 * The limit of 1000 texts only guards the size of the body; `MAX_ADDRESSES_PER_REQUEST` is the
 * real limit, counted after doubles are dropped.
 */
export const addMembersRequestSchema = z
  .strictObject({ emails: z.array(z.string().max(320)).min(1).max(1000) })
  .meta({ id: "AddMembersRequest" });
export type AddMembersRequest = z.infer<typeof addMembersRequestSchema>;

/** One result per address, in the order of the list after normalizing. */
export const addMembersResponseSchema = z
  .object({
    results: z.array(z.object({ email: z.string(), outcome: addMemberOutcomeSchema })),
  })
  .meta({ id: "AddMembersResponse" });
export type AddMembersResponse = z.infer<typeof addMembersResponseSchema>;
