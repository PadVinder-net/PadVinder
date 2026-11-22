import { liveEventSchema } from "@padvinder/contracts";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { DbTransaction } from "./client";

/** A PostgreSQL `NOTIFY` channel and the schema of its JSON payload, shared by sender and receiver. */
export type NotificationChannel<S extends z.ZodType = z.ZodType> = {
  readonly name: string;
  readonly schema: S;
};

/** A plain lowercase identifier, so `LISTEN <name>` needs no quoting and matches `pg_notify`. */
const CHANNEL_NAME = /^[a-z_][a-z0-9_]*$/;
/** PostgreSQL truncates longer identifiers; the name is ASCII, so characters are bytes. */
const MAX_CHANNEL_NAME_LENGTH = 63;

/** PostgreSQL rejects a `NOTIFY` payload of 8000 bytes or more (default build). */
const MAX_PAYLOAD_BYTES = 8_000;

export function defineChannel<S extends z.ZodType>(
  name: string,
  schema: S,
): NotificationChannel<S> {
  if (!CHANNEL_NAME.test(name) || name.length > MAX_CHANNEL_NAME_LENGTH) {
    throw new Error(
      `Invalid channel name ${JSON.stringify(name)}: use at most ${MAX_CHANNEL_NAME_LENGTH} characters a-z, 0-9 and _, not starting with a digit.`,
    );
  }
  return { name, schema };
}

/**
 * Validates the payload with the channel's schema and sends it with `pg_notify`. It takes the
 * transaction that commits the change, not the database: PostgreSQL delivers the notification
 * only on commit, and not at all on rollback.
 */
export async function notify<S extends z.ZodType>(
  tx: DbTransaction,
  channel: NotificationChannel<S>,
  payload: z.input<S>,
): Promise<void> {
  const json = JSON.stringify(channel.schema.parse(payload));
  const bytes = Buffer.byteLength(json);
  if (bytes >= MAX_PAYLOAD_BYTES) {
    throw new Error(
      `Notification payload for channel ${channel.name} is ${bytes} bytes; it must be shorter than ${MAX_PAYLOAD_BYTES} bytes. Send an ID and let the receiver load the rest.`,
    );
  }
  await tx.execute(sql`select pg_notify(${channel.name}, ${json})`);
}

/** All live events for the SSE stream: one channel, the payload is the `liveEventSchema` union. */
export const liveEventsChannel = defineChannel("live_events", liveEventSchema);

/**
 * Tells the user's open apps and event streams that their memberships, roles or requests
 * changed. Call it in the transaction that makes the change, and only when something changed.
 */
export async function notifyAccessChanged(tx: DbTransaction, userId: string): Promise<void> {
  await notify(tx, liveEventsChannel, { type: "access-changed", userId });
}

/**
 * Tells the coordinators of the group (and the admins of its organization) that a membership
 * request was created, withdrawn or decided. Call it in the transaction that makes the change.
 */
export async function notifyMembershipRequestsChanged(
  tx: DbTransaction,
  group: { workingGroupId: string; organizationId: string },
): Promise<void> {
  await notify(tx, liveEventsChannel, {
    type: "membership-requests-changed",
    workingGroupId: group.workingGroupId,
    organizationId: group.organizationId,
  });
}
