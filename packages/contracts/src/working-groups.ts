import { z } from "zod";

export const workingGroupSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    city: z.string(),
    organization: z.object({ id: z.string(), name: z.string() }),
  })
  .meta({ id: "WorkingGroupSummary" });
export type WorkingGroupSummary = z.infer<typeof workingGroupSummarySchema>;

export const workingGroupDirectoryResponseSchema = z
  .object({ workingGroups: z.array(workingGroupSummarySchema) })
  .meta({ id: "WorkingGroupDirectoryResponse" });
export type WorkingGroupDirectoryResponse = z.infer<typeof workingGroupDirectoryResponseSchema>;
