import { sql } from "drizzle-orm";
import { boolean, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// The tenant structure: PadVinder -> organization -> working group, and who belongs where.
// Ids are made by the database (a UUIDv7), as in `auth.ts`.

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const id = () =>
  uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey();

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

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
    unique("working_groups_organization_id_name_key").on(table.organizationId, table.name),
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
