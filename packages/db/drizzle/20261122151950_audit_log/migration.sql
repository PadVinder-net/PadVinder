CREATE TYPE "audit_actor_kind" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TABLE "audit_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "audit_actor_kind" NOT NULL,
	"actor_user_id" uuid,
	"organization_id" uuid,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"details" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_entries_organization_id_occurred_at_idx" ON "audit_log_entries" ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_entries_subject_type_subject_id_idx" ON "audit_log_entries" ("subject_type","subject_id");--> statement-breakpoint
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_actor_user_id_users_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");