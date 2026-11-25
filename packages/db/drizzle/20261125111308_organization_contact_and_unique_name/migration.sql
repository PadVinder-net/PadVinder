ALTER TABLE "organizations" ADD COLUMN "contact_email" text;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_name_key" ON "organizations" (lower("name"));