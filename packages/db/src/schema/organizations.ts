import { sql } from "drizzle-orm";
import {
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// The tenant structure: PadVinder -> organization -> working group, and who belongs where.
// Ids are made by the database (a UUIDv7), as in `auth.ts`.

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const id = () =>
  uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey();

// Names are stored normalized (`normalizeName`) and are unique regardless of capitals. Every
// organization has at least one admin (`organization_admins`); `createOrganization` makes the
// first in the same transaction, and nothing removes the last.
export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    // The address people are told to write to when something is wrong. Never in the audit log.
    contactEmail: text("contact_email"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("organizations_name_key").on(sql`lower(${table.name})`)],
);

// Names are stored normalized (`normalizeName`) and are unique within the organization regardless of
// capitals. Every active working group has at least one coordinator; `createWorkingGroup` makes the
// first in the same transaction, and nothing removes the last of an active group.
export const workingGroups = pgTable(
  "working_groups",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    city: text("city").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("working_groups_name_key").on(table.organizationId, sql`lower(${table.name})`),
  ],
);

export const workingGroupMemberships = pgTable(
  "working_group_memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workingGroupId: uuid("working_group_id")
      .notNull()
      .references(() => workingGroups.id),
    // Every member is a volunteer; a coordinator is a volunteer with this flag.
    isCoordinator: boolean("is_coordinator").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    unique("working_group_memberships_user_id_working_group_id_key").on(
      table.userId,
      table.workingGroupId,
    ),
  ],
);

export const organizationAdmins = pgTable(
  "organization_admins",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })],
);
