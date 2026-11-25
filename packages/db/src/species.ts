import { asc, eq, sql } from "drizzle-orm";
import { recordAudit, type AuditActor, type AuditDetails } from "./audit-log";
import type { Db, DbTransaction } from "./client";
import { species } from "./schema";

/** The fixed IDs of the five species the migration `official_species` inserts. */
export const officialSpeciesIds = {
  bruineKikker: "01a204b4-08c5-7dc9-8a38-6dc9ea3ae931",
  gewonePad: "01a204b4-08c6-7dc0-ae95-8072a93f1667",
  groeneKikker: "01a204b4-08c7-7d13-9c0d-b4ad4b6476e7",
  kamsalamander: "01a204b4-08c8-7753-aab2-dc5ce3aaa0bf",
  kleineWatersalamander: "01a204b4-08c9-7e6e-9b6a-6a9f3800a8ae",
} as const;

export type SpeciesRecord = {
  id: string;
  dutchName: string;
  scientificName: string;
  needsVerification: boolean;
  active: boolean;
};

export type SpeciesNameField = "dutchName" | "scientificName";

export type CreateSpeciesResult =
  | { outcome: "created"; species: SpeciesRecord }
  | { outcome: "name_taken"; field: SpeciesNameField };

export type UpdateSpeciesResult =
  | { outcome: "updated" | "unchanged"; species: SpeciesRecord }
  | { outcome: "not_found" }
  | { outcome: "name_taken"; field: SpeciesNameField };

export type SpeciesPatch = {
  dutchName?: string;
  scientificName?: string;
  needsVerification?: boolean;
  active?: boolean;
};

/**
 * Trims and turns every run of whitespace into one space. Capitals stay: a Dutch name may hold
 * one ("Italiaanse kamsalamander"). Uniqueness ignores capitals (the indexes are on `lower(...)`).
 */
export function normalizeSpeciesName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

const columns = {
  id: species.id,
  dutchName: species.dutchName,
  scientificName: species.scientificName,
  needsVerification: species.needsVerification,
  active: species.active,
};

/** Which field each unique index guards. */
const NAME_INDEXES: Record<string, SpeciesNameField> = {
  species_dutch_name_key: "dutchName",
  species_scientific_name_key: "scientificName",
};

/**
 * The field of a species name index that a unique_violation (23505) hit, also when Drizzle
 * wrapped the PostgreSQL error in a cause. `undefined` for any other error.
 */
function takenNameField(error: unknown): SpeciesNameField | undefined {
  for (let e = error, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === "23505" && typeof constraint === "string") return NAME_INDEXES[constraint];
  }
  return undefined;
}

/** All species, active or not, sorted by Dutch name in Dutch order. */
export function listSpecies(db: Db): Promise<SpeciesRecord[]> {
  return db
    .select(columns)
    .from(species)
    .orderBy(asc(sql`${species.dutchName} collate "nl-NL-x-icu"`), asc(species.id));
}

/**
 * Adds a species with normalized names and writes `species.created`. A name that another species
 * has, in any capitals, is `name_taken` with the field whose index refused it; that includes a
 * species created at the same moment by someone else.
 */
export async function createSpecies(
  db: Db,
  input: { dutchName: string; scientificName: string; needsVerification: boolean },
  actor: AuditActor,
): Promise<CreateSpeciesResult> {
  const values = {
    dutchName: normalizeSpeciesName(input.dutchName),
    scientificName: normalizeSpeciesName(input.scientificName),
    needsVerification: input.needsVerification,
  };
  try {
    return await db.transaction(async (tx): Promise<CreateSpeciesResult> => {
      const [created] = await tx.insert(species).values(values).returning(columns);
      if (!created) throw new Error("Inserting a species returned no row.");
      await recordAudit(tx, {
        actor,
        organizationId: null,
        action: "species.created",
        subject: { type: "species", id: created.id },
        details: { ...values },
      });
      return { outcome: "created", species: created };
    });
  } catch (error) {
    const field = takenNameField(error);
    if (field) return { outcome: "name_taken", field };
    throw error;
  }
}

/**
 * Changes the fields present in `patch`, with names normalized. Only fields whose value differs
 * from the stored one count: when none does, the result is `unchanged`, with no write and no
 * audit entry. Changed names and `needsVerification` give one `species.updated` with the old and
 * new value of each (`dutchNameFrom`, `dutchNameTo`, ...); a change of `active` is its own entry,
 * `species.deactivated` or `species.activated`. A name another species has is `name_taken`.
 */
export async function updateSpecies(
  db: Db,
  input: { id: string; patch: SpeciesPatch },
  actor: AuditActor,
): Promise<UpdateSpeciesResult> {
  try {
    return await db.transaction((tx) => applySpeciesPatch(tx, input, actor));
  } catch (error) {
    const field = takenNameField(error);
    if (field) return { outcome: "name_taken", field };
    throw error;
  }
}

async function applySpeciesPatch(
  tx: DbTransaction,
  input: { id: string; patch: SpeciesPatch },
  actor: AuditActor,
): Promise<UpdateSpeciesResult> {
  const [stored] = await tx
    .select(columns)
    .from(species)
    .where(eq(species.id, input.id))
    .for("update");
  if (!stored) return { outcome: "not_found" };

  const { patch } = input;
  const wanted: Omit<SpeciesRecord, "id"> = {
    dutchName:
      patch.dutchName === undefined ? stored.dutchName : normalizeSpeciesName(patch.dutchName),
    scientificName:
      patch.scientificName === undefined
        ? stored.scientificName
        : normalizeSpeciesName(patch.scientificName),
    needsVerification: patch.needsVerification ?? stored.needsVerification,
    active: patch.active ?? stored.active,
  };

  const details: AuditDetails = {};
  for (const field of ["dutchName", "scientificName", "needsVerification"] as const) {
    if (wanted[field] !== stored[field]) {
      details[`${field}From`] = stored[field];
      details[`${field}To`] = wanted[field];
    }
  }
  const activeChanged = wanted.active !== stored.active;
  if (Object.keys(details).length === 0 && !activeChanged) {
    return { outcome: "unchanged", species: stored };
  }

  const [updated] = await tx
    .update(species)
    .set({ ...wanted, updatedAt: sql`now()` })
    .where(eq(species.id, stored.id))
    .returning(columns);
  if (!updated) throw new Error("Updating a locked species returned no row.");

  const subject = { type: "species", id: stored.id } as const;
  if (Object.keys(details).length > 0) {
    await recordAudit(tx, {
      actor,
      organizationId: null,
      action: "species.updated",
      subject,
      details,
    });
  }
  if (activeChanged) {
    await recordAudit(tx, {
      actor,
      organizationId: null,
      action: wanted.active ? "species.activated" : "species.deactivated",
      subject,
    });
  }
  return { outcome: "updated", species: updated };
}
