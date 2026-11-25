import { z } from "zod";

/** One species of the official list. Switched-off species stay in the list, with `active` false. */
export const speciesSchema = z
  .object({
    id: z.string(),
    dutchName: z.string(),
    scientificName: z.string(),
    /** An observation of this species needs the check of an expert (a rare species). */
    needsVerification: z.boolean(),
    /** Switched off: no longer offered for new observations. A species is never deleted. */
    active: z.boolean(),
  })
  .meta({ id: "Species" });
export type Species = z.infer<typeof speciesSchema>;

export const speciesListResponseSchema = z
  .object({ species: z.array(speciesSchema) })
  .meta({ id: "SpeciesListResponse" });
export type SpeciesListResponse = z.infer<typeof speciesListResponseSchema>;

/**
 * A Dutch or scientific name: trimmed, 1 to 100 characters. The server also turns every run of
 * whitespace into one space. An `@` is refused: the audit log refuses text with one, and no
 * species name holds one.
 */
export const speciesNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((name) => !name.includes("@"), { message: "A name cannot contain @" });

export const createSpeciesRequestSchema = z
  .strictObject({
    dutchName: speciesNameSchema,
    scientificName: speciesNameSchema,
    needsVerification: z.boolean(),
  })
  .meta({ id: "CreateSpeciesRequest" });
export type CreateSpeciesRequest = z.infer<typeof createSpeciesRequestSchema>;

/** A `PATCH` body: present keys change, absent keys stay. At least one key. */
export const updateSpeciesRequestSchema = z
  .strictObject({
    dutchName: speciesNameSchema.optional(),
    scientificName: speciesNameSchema.optional(),
    needsVerification: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one field",
  })
  .meta({ id: "UpdateSpeciesRequest" });
export type UpdateSpeciesRequest = z.infer<typeof updateSpeciesRequestSchema>;
