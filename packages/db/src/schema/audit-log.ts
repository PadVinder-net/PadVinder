import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./organizations";

// Append-only: a trigger (migration `audit_log_append_only`) rejects UPDATE, DELETE and TRUNCATE.

export const auditActorKind = pgEnum("audit_actor_kind", ["user", "system"]);

export const auditLogEntries = pgTable(
  "audit_log_entries",
  {
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    actorKind: auditActorKind("actor_kind").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    organizationId: uuid("organization_id").references(() => organizations.id),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    details: jsonb("details")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
  },
  (table) => [
    index("audit_log_entries_organization_id_occurred_at_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
    index("audit_log_entries_subject_type_subject_id_idx").on(table.subjectType, table.subjectId),
  ],
);
