import { z } from "zod";
import { emailAddressSchema } from "./email";

/** A working group as the portal's administration shows it. */
export const managedWorkingGroupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    city: z.string(),
    active: z.boolean(),
    organization: z.object({ id: z.string(), name: z.string() }),
    /** Members, coordinators included. */
    memberCount: z.number().int(),
    /** Requests that wait for a decision. */
    pendingRequestCount: z.number().int(),
  })
  .meta({ id: "ManagedWorkingGroup" });
export type ManagedWorkingGroup = z.infer<typeof managedWorkingGroupSchema>;

export const managedWorkingGroupListResponseSchema = z
  .object({ workingGroups: z.array(managedWorkingGroupSchema) })
  .meta({ id: "ManagedWorkingGroupListResponse" });
export type ManagedWorkingGroupListResponse = z.infer<typeof managedWorkingGroupListResponseSchema>;

const textWithoutAt = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((text) => !text.includes("@"), { message: "Cannot contain @" });

/** A working group name: trimmed, 1 to 100 characters. An `@` is refused: the audit log refuses it. */
export const workingGroupNameSchema = textWithoutAt;
/** The place a working group works in: trimmed, 1 to 100 characters, without `@`. */
export const citySchema = textWithoutAt;

export const createWorkingGroupRequestSchema = z
  .strictObject({
    name: workingGroupNameSchema,
    city: citySchema,
    /** The first coordinator. An address without an account gets one. */
    coordinatorEmail: emailAddressSchema,
  })
  .meta({ id: "CreateWorkingGroupRequest" });
export type CreateWorkingGroupRequest = z.infer<typeof createWorkingGroupRequestSchema>;

/** A `PATCH` body: present keys change, absent keys stay. */
export const updateWorkingGroupRequestSchema = z
  .strictObject({
    name: workingGroupNameSchema.optional(),
    city: citySchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one field",
  })
  .meta({ id: "UpdateWorkingGroupRequest" });
export type UpdateWorkingGroupRequest = z.infer<typeof updateWorkingGroupRequestSchema>;

export const updateMembershipRequestSchema = z
  .strictObject({ isCoordinator: z.boolean() })
  .meta({ id: "UpdateMembershipRequest" });
export type UpdateMembershipRequest = z.infer<typeof updateMembershipRequestSchema>;
