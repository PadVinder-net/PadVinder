import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { workingGroups } from "./organizations";

// A volunteer asking to join a working group (glossary: aanmelding). The table below is the
// reference for a client-generated ID: `id` has NO default, because the app makes the UUIDv7 once
// and resends it on every retry; the server never replaces it (see AGENTS.md, "Data integrity").

export const membershipRequestStatus = pgEnum("membership_request_status", [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
]);

export const membershipRequests = pgTable(
  "membership_requests",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workingGroupId: uuid("working_group_id")
      .notNull()
      .references(() => workingGroups.id),
    status: membershipRequestStatus("status").notNull().default("pending"),
    // When the user acted (from the app), and when the server received it.
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
  },
  (table) => [
    uniqueIndex("membership_requests_one_pending_key")
      .on(table.userId, table.workingGroupId)
      .where(sql`${table.status} = 'pending'`),
    index("membership_requests_group_status_idx").on(table.workingGroupId, table.status),
  ],
);
