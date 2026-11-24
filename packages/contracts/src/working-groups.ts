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
