import type { Species } from "../species";

/** The five official species with their fixed IDs, and one made-up species that is switched off. */
export const speciesFixture: Species[] = [
  {
    id: "01a204b4-08c5-7dc9-8a38-6dc9ea3ae931",
    dutchName: "bruine kikker",
    scientificName: "Rana temporaria",
    needsVerification: false,
    active: true,
  },
  {
    id: "01a204b4-08c6-7dc0-ae95-8072a93f1667",
    dutchName: "gewone pad",
    scientificName: "Bufo bufo",
    needsVerification: false,
    active: true,
  },
  {
    id: "01a204b4-08c7-7d13-9c0d-b4ad4b6476e7",
    dutchName: "groene kikker",
    scientificName: "Pelophylax esculentus synklepton",
    needsVerification: false,
    active: true,
  },
  {
    id: "01a204b4-08c8-7753-aab2-dc5ce3aaa0bf",
    dutchName: "kamsalamander",
    scientificName: "Triturus cristatus",
    needsVerification: true,
    active: true,
  },
  {
    id: "01a204b4-08c9-7e6e-9b6a-6a9f3800a8ae",
    dutchName: "kleine watersalamander",
    scientificName: "Lissotriton vulgaris",
    needsVerification: false,
    active: true,
  },
  {
    id: "0192f3c0-0000-7000-8000-0000000005a1",
    dutchName: "vuursalamander",
    scientificName: "Salamandra salamandra",
    needsVerification: true,
    active: false,
  },
];
