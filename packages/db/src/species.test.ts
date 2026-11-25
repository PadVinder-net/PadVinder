import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { auditLogEntries, species } from "./schema";
import {
  createSpecies,
  listSpecies,
  normalizeSpeciesName,
  officialSpeciesIds,
  updateSpecies,
} from "./species";
import { createTestDatabase, type TestDatabase } from "./testing";

// One database for the file. Audit entries cannot be deleted, so tests count the entries of one
// subject (`entriesOf`), and tests that change a species make their own or put it back.
let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});
const system = { kind: "system" } as const;

const entriesOf = (subjectId: string) =>
  t!.db
    .select()
    .from(auditLogEntries)
    .where(eq(auditLogEntries.subjectId, subjectId))
    .orderBy(auditLogEntries.occurredAt, auditLogEntries.id);

async function newSpecies(dutchName: string, scientificName: string) {
  const result = await createSpecies(
    t!.db,
    { dutchName, scientificName, needsVerification: false },
    system,
  );
  if (result.outcome !== "created") throw new Error(`not created: ${JSON.stringify(result)}`);
  return result.species;
}

test("a migrated database holds exactly the five official species, sorted by Dutch name", async () => {
  expect(
    (await listSpecies(t!.db)).map((s) => [
      s.id,
      s.dutchName,
      s.scientificName,
      s.needsVerification,
      s.active,
    ]),
  ).toEqual([
    [officialSpeciesIds.bruineKikker, "bruine kikker", "Rana temporaria", false, true],
    [officialSpeciesIds.gewonePad, "gewone pad", "Bufo bufo", false, true],
    [
      officialSpeciesIds.groeneKikker,
      "groene kikker",
      "Pelophylax esculentus synklepton",
      false,
      true,
    ],
    [officialSpeciesIds.kamsalamander, "kamsalamander", "Triturus cristatus", true, true],
    [
      officialSpeciesIds.kleineWatersalamander,
      "kleine watersalamander",
      "Lissotriton vulgaris",
      false,
      true,
    ],
  ]);
});

test.each([
  ["  gewone   pad ", "gewone pad"],
  ["gewone\tpad\n", "gewone pad"],
  ["Italiaanse kamsalamander", "Italiaanse kamsalamander"],
  ["   ", ""],
])("normalizeSpeciesName(%j) is %j", (input, expected) => {
  expect(normalizeSpeciesName(input)).toBe(expected);
});

test("creates a species with one audit entry", async () => {
  const result = await createSpecies(
    t!.db,
    {
      dutchName: " alpenwatersalamander ",
      scientificName: "Ichthyosaura  alpestris",
      needsVerification: true,
    },
    system,
  );
  expect(result).toMatchObject({
    outcome: "created",
    species: {
      dutchName: "alpenwatersalamander",
      scientificName: "Ichthyosaura alpestris",
      needsVerification: true,
      active: true,
    },
  });
  if (result.outcome !== "created") throw new Error("not created");
  expect(Object.keys(result.species).sort()).toEqual(
    ["active", "dutchName", "id", "needsVerification", "scientificName"].sort(),
  );
  const entries = await entriesOf(result.species.id);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    actorKind: "system",
    actorUserId: null,
    action: "species.created",
    organizationId: null,
    subjectType: "species",
    subjectId: result.species.id,
    details: {
      dutchName: "alpenwatersalamander",
      scientificName: "Ichthyosaura alpestris",
      needsVerification: true,
    },
  });
  expect(Object.keys(entries[0]!.details).sort()).toEqual(
    ["dutchName", "needsVerification", "scientificName"].sort(),
  );
});

test.each([
  ["Gewone Pad", "Bufo novus", "dutchName"],
  ["gewone  pad ", "Bufo novus", "dutchName"],
  ["nieuwe pad", "BUFO BUFO", "scientificName"],
  ["nieuwe pad", " bufo  bufo", "scientificName"],
])(
  "refuses %j / %j as name_taken on %s and stores nothing",
  async (dutchName, scientificName, field) => {
    const before = await listSpecies(t!.db);
    const entriesBefore = (await t!.db.select().from(auditLogEntries)).length;
    expect(
      await createSpecies(t!.db, { dutchName, scientificName, needsVerification: false }, system),
    ).toEqual({ outcome: "name_taken", field });
    expect(await listSpecies(t!.db)).toEqual(before);
    expect(await t!.db.select().from(auditLogEntries)).toHaveLength(entriesBefore);
  },
);

test("two creates of the same name at the same moment give one species", async () => {
  const input = {
    dutchName: "vuursalamander",
    scientificName: "Salamandra salamandra",
    needsVerification: true,
  };
  const results = await Promise.all([
    createSpecies(t!.db, input, system),
    createSpecies(t!.db, input, system),
  ]);
  expect(results.map((r) => r.outcome).sort()).toEqual(["created", "name_taken"]);
  const stored = await t!.db.select().from(species).where(eq(species.dutchName, "vuursalamander"));
  expect(stored).toHaveLength(1);
  expect(await entriesOf(stored[0]!.id)).toHaveLength(1);
});

test("a rename keeps the old and the new value in the audit entry", async () => {
  const pad = await newSpecies("rugstreeppad", "Epidalea calamita");
  const result = await updateSpecies(
    t!.db,
    { id: pad.id, patch: { dutchName: "rugstreep pad" } },
    system,
  );
  expect(result).toEqual({
    outcome: "updated",
    species: { ...pad, dutchName: "rugstreep pad" },
  });
  const entries = await entriesOf(pad.id);
  expect(entries.map((e) => e.action)).toEqual(["species.created", "species.updated"]);
  expect(entries[1]).toMatchObject({ organizationId: null, subjectType: "species" });
  expect(entries[1]!.details).toEqual({
    dutchNameFrom: "rugstreeppad",
    dutchNameTo: "rugstreep pad",
  });
});

test("an update of every field records each change and moves updated_at", async () => {
  const frog = await newSpecies("heikikker", "Rana arvalis");
  const [{ updatedAt: before } = { updatedAt: new Date(0) }] = await t!.db
    .select({ updatedAt: species.updatedAt })
    .from(species)
    .where(eq(species.id, frog.id));
  const result = await updateSpecies(
    t!.db,
    {
      id: frog.id,
      patch: {
        dutchName: " Heikikker  (bruin) ",
        scientificName: "Rana  arvalis arvalis",
        needsVerification: true,
      },
    },
    system,
  );
  expect(result).toEqual({
    outcome: "updated",
    species: {
      ...frog,
      dutchName: "Heikikker (bruin)",
      scientificName: "Rana arvalis arvalis",
      needsVerification: true,
    },
  });
  const entries = await entriesOf(frog.id);
  expect(entries.at(-1)!.details).toEqual({
    dutchNameFrom: "heikikker",
    dutchNameTo: "Heikikker (bruin)",
    scientificNameFrom: "Rana arvalis",
    scientificNameTo: "Rana arvalis arvalis",
    needsVerificationFrom: false,
    needsVerificationTo: true,
  });
  const [{ updatedAt: after } = { updatedAt: new Date(0) }] = await t!.db
    .select({ updatedAt: species.updatedAt })
    .from(species)
    .where(eq(species.id, frog.id));
  expect(after.getTime()).toBeGreaterThan(before.getTime());
});

test("a patch that changes nothing is unchanged and writes no entry", async () => {
  const [{ updatedAt: before } = { updatedAt: new Date(0) }] = await t!.db
    .select({ updatedAt: species.updatedAt })
    .from(species)
    .where(eq(species.id, officialSpeciesIds.gewonePad));
  const result = await updateSpecies(
    t!.db,
    {
      id: officialSpeciesIds.gewonePad,
      patch: { dutchName: " gewone  pad", scientificName: "Bufo bufo", active: true },
    },
    system,
  );
  expect(result).toEqual({
    outcome: "unchanged",
    species: {
      id: officialSpeciesIds.gewonePad,
      dutchName: "gewone pad",
      scientificName: "Bufo bufo",
      needsVerification: false,
      active: true,
    },
  });
  expect(await entriesOf(officialSpeciesIds.gewonePad)).toHaveLength(0);
  const [{ updatedAt: after } = { updatedAt: new Date(0) }] = await t!.db
    .select({ updatedAt: species.updatedAt })
    .from(species)
    .where(eq(species.id, officialSpeciesIds.gewonePad));
  expect(after).toEqual(before);
});

test("an empty patch is unchanged", async () => {
  const result = await updateSpecies(
    t!.db,
    { id: officialSpeciesIds.bruineKikker, patch: {} },
    system,
  );
  expect(result.outcome).toBe("unchanged");
  expect(await entriesOf(officialSpeciesIds.bruineKikker)).toHaveLength(0);
});

test("switching off and on writes species.deactivated and species.activated; twice off is unchanged", async () => {
  const newt = await newSpecies("marmersalamander", "Triturus marmoratus");
  const off = await updateSpecies(t!.db, { id: newt.id, patch: { active: false } }, system);
  expect(off).toEqual({ outcome: "updated", species: { ...newt, active: false } });
  const again = await updateSpecies(t!.db, { id: newt.id, patch: { active: false } }, system);
  expect(again).toEqual({ outcome: "unchanged", species: { ...newt, active: false } });
  // An inactive species is still listed.
  expect((await listSpecies(t!.db)).find((s) => s.id === newt.id)).toEqual({
    ...newt,
    active: false,
  });
  const on = await updateSpecies(t!.db, { id: newt.id, patch: { active: true } }, system);
  expect(on).toEqual({ outcome: "updated", species: newt });

  const entries = await entriesOf(newt.id);
  expect(entries.map((e) => [e.action, e.details])).toEqual([
    ["species.created", expect.any(Object)],
    ["species.deactivated", {}],
    ["species.activated", {}],
  ]);
  expect(entries.every((e) => e.organizationId === null && e.subjectType === "species")).toBe(true);
});

test("a patch that changes a name and active writes two entries", async () => {
  const newt = await newSpecies("vinpootsalamander", "Lissotriton helveticus");
  const result = await updateSpecies(
    t!.db,
    { id: newt.id, patch: { dutchName: "vinpoot salamander", active: false } },
    system,
  );
  expect(result).toEqual({
    outcome: "updated",
    species: { ...newt, dutchName: "vinpoot salamander", active: false },
  });
  const entries = await entriesOf(newt.id);
  expect(entries.slice(1).map((e) => [e.action, e.details])).toEqual(
    expect.arrayContaining([
      [
        "species.updated",
        { dutchNameFrom: "vinpootsalamander", dutchNameTo: "vinpoot salamander" },
      ],
      ["species.deactivated", {}],
    ]),
  );
  expect(entries).toHaveLength(3);
});

test.each([
  [{ dutchName: "Bruine  Kikker" }, "dutchName"],
  [{ scientificName: "rana temporaria" }, "scientificName"],
])("a rename to another species' name is name_taken: %j", async (patch, field) => {
  const toad = await newSpecies(`knoflookpad ${field}`, `Pelobates fuscus ${field}`);
  expect(await updateSpecies(t!.db, { id: toad.id, patch }, system)).toEqual({
    outcome: "name_taken",
    field,
  });
  expect((await listSpecies(t!.db)).find((s) => s.id === toad.id)).toEqual(toad);
  expect(await entriesOf(toad.id)).toHaveLength(1);
});

test("renaming a species to its own name in other capitals works", async () => {
  const toad = await newSpecies("geelbuikvuurpad", "Bombina variegata");
  const result = await updateSpecies(
    t!.db,
    { id: toad.id, patch: { dutchName: "Geelbuikvuurpad", scientificName: "bombina Variegata" } },
    system,
  );
  expect(result).toEqual({
    outcome: "updated",
    species: { ...toad, dutchName: "Geelbuikvuurpad", scientificName: "bombina Variegata" },
  });
});

test("an unknown id is not_found", async () => {
  expect(
    await updateSpecies(
      t!.db,
      { id: "01a204b4-0000-7000-8000-000000000000", patch: { active: false } },
      system,
    ),
  ).toEqual({ outcome: "not_found" });
});

test("a name with a capital is kept", async () => {
  const newt = await newSpecies("Italiaanse kamsalamander", "Triturus carnifex");
  expect(newt.dutchName).toBe("Italiaanse kamsalamander");
  expect((await listSpecies(t!.db)).find((s) => s.id === newt.id)?.dutchName).toBe(
    "Italiaanse kamsalamander",
  );
});

test("the list sorts Dutch names in Dutch order, ignoring capitals", async () => {
  const names = (await listSpecies(t!.db)).map((s) => s.dutchName);
  expect(names).toEqual(
    [...names].sort((a, b) => a.localeCompare(b, "nl", { sensitivity: "base" })),
  );
  expect(names.indexOf("Italiaanse kamsalamander")).toBeLessThan(names.indexOf("kamsalamander"));
});
