import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// The tables of Better Auth 1.7.27 (user, session, account, verification, rate limit), with
// plural snake_case names and `timestamptz`. Better Auth is configured with
// `advanced.database.generateId: "uuid"`: on PostgreSQL it then leaves the id to the database,
// so the default below makes every id (a UUIDv7, PostgreSQL 18).
// Keep the columns in line with Better Auth: do not rename or drop one without checking it.
// Better Auth checks this schema against its own when it is first used.

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () =>
  uuid("id")
    .default(sql`uuidv7()`)
    .primaryKey();

export const users = pgTable("users", {
  id: id(),
  // Empty string for a new account until the volunteer fills in a name.
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  // Ours, not Better Auth's. Optional.
  phone: text("phone"),
  // Ours. Set only by hand in the database or by a platform admin, never through Better Auth.
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  // Ours. Set when an account is deleted; never through Better Auth's client.
  deletedAt: timestamptz("deleted_at"),
  // Ours. The moment of the newest login (a session made, not renewed); null until someone has
  // logged in, so an account made by the admin tool is told apart from one that was used.
  lastLoginAt: timestamptz("last_login_at"),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    expiresAt: timestamptz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamptz("access_token_expires_at"),
    refreshTokenExpiresAt: timestamptz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

// Also holds the one-time login codes of the email OTP plugin.
export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

// One row per IP address and path. Better Auth never deletes them; `pruneLoginData` does.
export const rateLimits = pgTable(
  "rate_limits",
  {
    id: id(),
    key: text("key").notNull().unique(),
    count: integer("count").notNull(),
    // Milliseconds since the epoch (Date.now()), not a timestamp: Better Auth stores a number.
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (table) => [index("rate_limits_last_request_idx").on(table.lastRequest)],
);
