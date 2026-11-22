CREATE TYPE "membership_request_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TABLE "membership_requests" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"working_group_id" uuid NOT NULL,
	"status" "membership_request_status" DEFAULT 'pending'::"membership_request_status" NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_requests_one_pending_key" ON "membership_requests" ("user_id","working_group_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "membership_requests_group_status_idx" ON "membership_requests" ("working_group_id","status");--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_working_group_id_working_groups_id_fkey" FOREIGN KEY ("working_group_id") REFERENCES "working_groups"("id");--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_decided_by_user_id_users_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id");