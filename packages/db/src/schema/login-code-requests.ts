import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// One row per requested login code, to rate-limit requests per email address. It holds email
// addresses, so rows older than 24 hours are pruned (see `recordLoginCodeRequest`).
export const loginCodeRequests = pgTable(
  "login_code_requests",
  {
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    email: text("email").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("login_code_requests_email_requested_at_idx").on(table.email, table.requestedAt),
  ],
);
