CREATE TABLE "species" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"dutch_name" text NOT NULL,
	"scientific_name" text NOT NULL,
	"needs_verification" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "species_dutch_name_key" ON "species" (lower("dutch_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "species_scientific_name_key" ON "species" (lower("scientific_name"));