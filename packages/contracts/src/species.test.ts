import { expect, test } from "vitest";
import { speciesFixture } from "./fixtures";
import {
  createSpeciesRequestSchema,
  speciesListResponseSchema,
  speciesNameSchema,
  speciesSchema,
  updateSpeciesRequestSchema,
} from "./species";

test("a name is trimmed", () =>
  expect(speciesNameSchema.parse("  gewone pad ")).toBe("gewone pad"));

test("a name of 100 characters is accepted", () =>
  expect(speciesNameSchema.parse("x".repeat(100))).toHaveLength(100));

test("markup in a name is kept as typed", () =>
  expect(speciesNameSchema.parse("<i>Bufo</i> x")).toBe("<i>Bufo</i> x"));

test.each(["", "   ", "x".repeat(101), "pad@x"])("a name %j is refused", (name) =>
  expect(speciesNameSchema.safeParse(name).success).toBe(false),
);

test("create accepts a full body", () =>
  expect(
    createSpeciesRequestSchema.parse({
      dutchName: " vuursalamander ",
      scientificName: "Salamandra salamandra",
      needsVerification: true,
    }),
  ).toEqual({
    dutchName: "vuursalamander",
    scientificName: "Salamandra salamandra",
    needsVerification: true,
  }));

test.each([
  [{ dutchName: " ", scientificName: "X y", needsVerification: false }],
  [{ dutchName: "x".repeat(101), scientificName: "X y", needsVerification: false }],
  [{ dutchName: "x", scientificName: "X y" }],
  [{ dutchName: "x", scientificName: "X y", needsVerification: false, extra: 1 }],
  [{ dutchName: "x", scientificName: "X @y", needsVerification: false }],
  [{ dutchName: "x", scientificName: "X y", needsVerification: "false" }],
])("create rejects %j", (body) =>
  expect(createSpeciesRequestSchema.safeParse(body).success).toBe(false),
);

test("update accepts each key alone", () => {
  expect(updateSpeciesRequestSchema.parse({ dutchName: " pad " })).toEqual({ dutchName: "pad" });
  expect(updateSpeciesRequestSchema.parse({ scientificName: "Bufo" })).toEqual({
    scientificName: "Bufo",
  });
  expect(updateSpeciesRequestSchema.parse({ needsVerification: true })).toEqual({
    needsVerification: true,
  });
  expect(updateSpeciesRequestSchema.parse({ active: false })).toEqual({ active: false });
});

test.each([
  [{}],
  [{ dutchName: "x", extra: 1 }],
  [{ id: "01a204b4-08c6-7dc0-ae95-8072a93f1667" }],
  [{ dutchName: "  " }],
  [{ dutchName: null }],
  [{ active: null }],
])("update rejects an empty body, an unknown key and a bad value: %j", (body) =>
  expect(updateSpeciesRequestSchema.safeParse(body).success).toBe(false),
);

test("every fixture parses", () => {
  for (const species of speciesFixture) expect(speciesSchema.parse(species)).toEqual(species);
  expect(speciesListResponseSchema.parse({ species: speciesFixture })).toEqual({
    species: speciesFixture,
  });
});

test("the fixture holds the five official species and one that is switched off", () => {
  expect(speciesFixture.filter((s) => s.active)).toHaveLength(5);
  expect(speciesFixture.find((s) => !s.active)).toMatchObject({
    dutchName: "vuursalamander",
    scientificName: "Salamandra salamandra",
    needsVerification: true,
  });
  expect(speciesFixture.find((s) => s.id === "01a204b4-08c8-7753-aab2-dc5ce3aaa0bf")).toEqual({
    id: "01a204b4-08c8-7753-aab2-dc5ce3aaa0bf",
    dutchName: "kamsalamander",
    scientificName: "Triturus cristatus",
    needsVerification: true,
    active: true,
  });
});
