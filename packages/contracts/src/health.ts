import { z } from "zod";

const timestampSchema = z.iso.datetime({ offset: true });

export const overallStatusSchema = z.enum(["ok", "degraded"]);
export type OverallStatus = z.infer<typeof overallStatusSchema>;

/** The worker counts as gone when its last heartbeat is older than this. */
export const HEARTBEAT_STALE_AFTER_MS = 180_000;

export function deriveOverallStatus(input: {
  databaseReachable: boolean;
  lastHeartbeatAt: Date | null;
  now: Date;
}): OverallStatus {
  if (!input.databaseReachable || input.lastHeartbeatAt === null) return "degraded";
  const ageMs = input.now.getTime() - input.lastHeartbeatAt.getTime();
  return ageMs <= HEARTBEAT_STALE_AFTER_MS ? "ok" : "degraded";
}

export const healthResponseSchema = z
  .object({
    status: overallStatusSchema,
    commit: z.string(),
    checkedAt: timestampSchema,
    database: z.object({
      reachable: z.boolean(),
      /** `true` when the caller may not see the details: the three fields below are `null`. */
      detailsHidden: z.boolean(),
      postgresVersion: z.string().nullable(),
      postgisVersion: z.string().nullable(),
      latestMigration: z.object({ name: z.string(), createdAt: timestampSchema }).nullable(),
    }),
    worker: z.object({ lastHeartbeatAt: timestampSchema.nullable() }),
  })
  .meta({ id: "HealthResponse" });
export type HealthResponse = z.infer<typeof healthResponseSchema>;
