CREATE TYPE "membership_role" AS ENUM('volunteer', 'coordinator');--> statement-breakpoint
CREATE TABLE "organization_admins" (
	"user_id" uuid,
	"organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_admins_pkey" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working_group_memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" uuid NOT NULL,
	"working_group_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_group_memberships_user_id_working_group_id_key" UNIQUE("user_id","working_group_id")
);
--> statement-breakpoint
CREATE TABLE "working_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_groups_organization_id_name_key" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_admins" ADD CONSTRAINT "organization_admins_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_admins" ADD CONSTRAINT "organization_admins_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");--> statement-breakpoint
ALTER TABLE "working_group_memberships" ADD CONSTRAINT "working_group_memberships_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "working_group_memberships" ADD CONSTRAINT "working_group_memberships_sWENEAqytSwo_fkey" FOREIGN KEY ("working_group_id") REFERENCES "working_groups"("id");--> statement-breakpoint
ALTER TABLE "working_groups" ADD CONSTRAINT "working_groups_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");