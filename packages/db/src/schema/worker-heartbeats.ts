import { pgTable, timestamp } from "drizzle-orm/pg-core";

// System table written by the worker, keyed by time. Tables for registrations
// from the field use a client-generated UUIDv7 primary key (AGENTS.md).
export const workerHeartbeats = pgTable("worker_heartbeats", {
  beatAt: timestamp("beat_at", { withTimezone: true, mode: "date" }).primaryKey(),
});
