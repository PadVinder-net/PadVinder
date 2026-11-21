import { z } from "zod";

export const workerHeartbeatEventSchema = z.object({
  type: z.literal("worker-heartbeat"),
  beatAt: z.iso.datetime({ offset: true }),
});
export type WorkerHeartbeatEvent = z.infer<typeof workerHeartbeatEventSchema>;

/**
 * Everything the live stream (`/api/events`) can carry. To add an event, add a member here: its
 * `type` is the SSE event name. Events that belong to an organization will carry
 * `organizationId`, so the stream can filter on it once there is a login.
 */
export const liveEventSchema = z.discriminatedUnion("type", [workerHeartbeatEventSchema]);
export type LiveEvent = z.infer<typeof liveEventSchema>;
export type LiveEventType = LiveEvent["type"];

/** The `type` of every union member, for the client to register one listener each. */
export const LIVE_EVENT_TYPES: readonly LiveEventType[] = liveEventSchema.options.map(
  (option) => option.shape.type.value,
);
