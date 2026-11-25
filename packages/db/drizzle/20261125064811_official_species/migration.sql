-- The five official species, with fixed IDs (`officialSpeciesIds` in src/species.ts). The species
-- list is shared by all organizations by design (see src/schema/species.ts). Never edit this
-- migration: later changes to these rows are made by platform admins and go through the audit log.
INSERT INTO "species" ("id", "dutch_name", "scientific_name", "needs_verification") VALUES
	('01a204b4-08c5-7dc9-8a38-6dc9ea3ae931', 'bruine kikker', 'Rana temporaria', false),
	('01a204b4-08c6-7dc0-ae95-8072a93f1667', 'gewone pad', 'Bufo bufo', false),
	('01a204b4-08c7-7d13-9c0d-b4ad4b6476e7', 'groene kikker', 'Pelophylax esculentus synklepton', false),
	('01a204b4-08c8-7753-aab2-dc5ce3aaa0bf', 'kamsalamander', 'Triturus cristatus', true),
	('01a204b4-08c9-7e6e-9b6a-6a9f3800a8ae', 'kleine watersalamander', 'Lissotriton vulgaris', false)
ON CONFLICT DO NOTHING;
