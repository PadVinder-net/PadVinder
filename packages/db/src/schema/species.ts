import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// The official species list (glossary: soort), managed by platform admins. By design it is shared
// by all organizations and not scoped by one: every organization counts the same species. Do not
// copy this to tenant data; everything an organization owns is scoped by organization.
//
// The first five rows come from the migration `official_species`, with fixed IDs
// (`officialSpeciesIds` in `../species.ts`). A species is never deleted, only switched off.
// Names are stored normalized (`normalizeSpeciesName`) and are unique regardless of capitals.

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const species = pgTable(
  "species",
  {
    id: uuid("id")
      .default(sql`uuidv7()`)
      .primaryKey(),
    dutchName: text("dutch_name").notNull(),
    scientificName: text("scientific_name").notNull(),
    needsVerification: boolean("needs_verification").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamptz("created_at"),
    updatedAt: timestamptz("updated_at"),
  },
  (table) => [
    uniqueIndex("species_dutch_name_key").on(sql`lower(${table.dutchName})`),
    uniqueIndex("species_scientific_name_key").on(sql`lower(${table.scientificName})`),
  ],
);
