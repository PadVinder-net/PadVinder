import { z } from "zod";

export const workerHeartbeatEventSchema = z.object({
  type: z.literal("worker-heartbeat"),
  beatAt: z.iso.datetime({ offset: true }),
});
export type WorkerHeartbeatEvent = z.infer<typeof workerHeartbeatEventSchema>;

/**
 * Everything the live stream (`/api/events`) can carry. To add an event, add a member here: its
 * `type` is the SSE event name. Declare its audience in `liveEventAudiences` and give it the IDs
 * that audience needs: an event for `user` carries `userId`; for `working-group-coordinators`
 * and `working-group-members` `workingGroupId` and `organizationId`; for `organization`
 * `organizationId`. Events carry IDs only, never records or names.
 */
export const liveEventSchema = z.discriminatedUnion("type", [workerHeartbeatEventSchema]);
export type LiveEvent = z.infer<typeof liveEventSchema>;
export type LiveEventType = LiveEvent["type"];

/** The `type` of every union member, for the client to register one listener each. */
export const LIVE_EVENT_TYPES: readonly LiveEventType[] = liveEventSchema.options.map(
  (option) => option.shape.type.value,
);

/**
 * Who receives an event. Platform admins receive every event except those for `user`: an event
 * addressed to one person reaches only that person.
 */
export type LiveEventAudience =
  | "user"
  | "working-group-coordinators"
  | "working-group-members"
  | "organization"
  | "platform-admins";

/**
 * The audience of each event type. Complete: a type added to the union without an audience is a
 * type error here, so no event goes out without a decision about who receives it.
 */
export const liveEventAudiences: Record<LiveEventType, LiveEventAudience> = {
  "worker-heartbeat": "platform-admins",
};
