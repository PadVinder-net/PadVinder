# Portal Shell and Species Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pull request 1 of "Portal administration": the portal gets a layout with navigation by role, and platform admins manage the one official species list, which starts with five species in every environment.

**Architecture:** The species table is the one domain table that is not scoped by organization. A migration creates it and a second, hand-written one inserts the five official species with fixed IDs. Changes go through functions in `packages/db` that write the row and its audit entry in one transaction; the routes authorize with a new platform-level permission. The portal gets a layout route with a navigation list computed from `/api/me` by one pure function, which the later plans of this part extend.

**Tech Stack:** The existing stack, plus shadcn/ui's `table`, `dialog`, `sonner` and `checkbox`.

**Spec:** `docs/superpowers/specs/2026-11-22-portal-administration-design.md` (read it, the design of part 1 `2026-11-21-accounts-and-access-design.md`, and `AGENTS.md` before starting any task). This plan covers item 1 under "Order of work".

**Builds on:** all three pull requests of part 1, merged. This plan was written while the third ("joining") was not yet open. Names marked _(from the joining plan)_ come from `docs/superpowers/plans/2026-11-22-joining.md`, not from code: check the real name before you use it, and keep the behavior asked here.

## Global Constraints

- AGENTS.md applies in full: English code, Dutch UI copy with "je", English kebab-case URL paths, glossary terms, naming per location, generated files never edited by hand.
- Run `pnpm check` before every commit (it includes `check:generated`). After any change to a route or contract run `pnpm api:generate`; after any schema change run `pnpm db:generate`. Commit the generated files.
- Every new or changed story needs its reference image: run `pnpm screenshots:update` (Docker; never on the host) and commit the images, otherwise the `visual` check fails.
- Routes reach the user only through `request.actor` and decide only through `authorize` or `decide` (`apps/api/src/permissions/rules.ts`). Every endpoint behind a permission has one `expectStatuses` test with the standard cast (`apps/api/src/testing/cast.ts`).
- Answers: 401 without a login; 403 for what the actor may see but not change; 404 for what does not exist; 409 for a conflict. Error bodies follow `apiErrorSchema`; the portal chooses the Dutch text from `code` and never shows `message`.
- `PATCH` takes a strict, partial object: absent keys stay, unknown keys and an empty body are 400.
- A change and its audit entry (`recordAudit`) go in one transaction. Audit details never hold a name of a person, an email address or a phone number; the names of species are fine.
- A species is never deleted. There is no delete function and no `DELETE` route.
- The first five species are inserted by a migration, with the fixed IDs below. That migration is never edited afterwards. The seed adds no species.
- Sort Dutch names with `COLLATE "nl-NL-x-icu"`.
- The API stays backward compatible: only add fields to existing responses.
- Dutch copy in this plan is exact. Where a small text is missing, write it in the same style.
- Commit after every task with a message in English, ending with the co-author line your session's instructions give.

The five official species (the spec, "Species"):

| ID                                     | Dutch name             | Scientific name                  | Needs the check |
| -------------------------------------- | ---------------------- | -------------------------------- | --------------- |
| `01a204b4-08c5-7dc9-8a38-6dc9ea3ae931` | bruine kikker          | Rana temporaria                  | no              |
| `01a204b4-08c6-7dc0-ae95-8072a93f1667` | gewone pad             | Bufo bufo                        | no              |
| `01a204b4-08c7-7d13-9c0d-b4ad4b6476e7` | groene kikker          | Pelophylax esculentus synklepton | no              |
| `01a204b4-08c8-7753-aab2-dc5ce3aaa0bf` | kamsalamander          | Triturus cristatus               | yes             |
| `01a204b4-08c9-7e6e-9b6a-6a9f3800a8ae` | kleine watersalamander | Lissotriton vulgaris             | no              |

## Review Focus

1. **The same name in another shape.** `Gewone Pad`, `gewone pad ` and `gewone  pad` are one name: the second is refused with 409, never stored and never a 500. Two admins saving the same new name at the same moment give one species. Pinned in Task 1 and Task 2.
2. **A save that changes nothing.** Saving the form without a change, or switching off a species that is off, answers 200 and writes no audit entry. Pinned in Task 1.
3. **Someone who may not manage species** opens `/species` by address, or calls the API directly. The page shows the not-found text and the API answers 403; nothing in the list of species is secret, so reading stays allowed. Pinned in Task 2 and Task 7.
4. **Odd input in a name:** only spaces, 101 characters, markup such as `<i>Bufo</i>`. The first two are refused with a clear text; the third is stored and shown as plain text. Pinned in Task 2 and Task 5.
5. **Rights change while the portal is open.** A platform admin loses the flag, or a volunteer becomes one: the navigation follows without a reload, and an open species page turns into the not-found text. Pinned in Task 6.

---

### Task 1: The species table, its five rows and its functions

**Files:**

- Create: `packages/db/src/schema/species.ts`, `packages/db/src/species.ts`
- Create (generated): one migration for the table; one custom migration for the rows (`pnpm --filter @padvinder/db exec drizzle-kit generate --custom --name official_species`)
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`, `packages/db/src/audit-log.ts`
- Test: `packages/db/src/species.test.ts`, `packages/db/src/migrate.test.ts`

**Interfaces:**

- Produces (table) `species`: `id uuid primary key default uuidv7()`, `dutch_name text not null`, `scientific_name text not null`, `needs_verification boolean not null default false`, `active boolean not null default true`, `created_at` and `updated_at` (`timestamptz not null default now()`). Unique indexes `species_dutch_name_key` on `lower(dutch_name)` and `species_scientific_name_key` on `lower(scientific_name)`. A comment says: the official list, shared by all organizations and not scoped by one, by design; do not copy this to tenant data.
- The custom migration inserts the five rows from the table above with `on conflict do nothing`.
- Produces (from `@padvinder/db`):
  - `officialSpeciesIds = { bruineKikker, gewonePad, groeneKikker, kamsalamander, kleineWatersalamander }` (the fixed IDs, for tests and fixtures of later slices).
  - `type SpeciesRecord = { id: string; dutchName: string; scientificName: string; needsVerification: boolean; active: boolean }`
  - `normalizeSpeciesName(name: string): string`: trims and turns every run of whitespace into one space. It does not change capitals: a Dutch name may hold one ("Italiaanse kamsalamander").
  - `listSpecies(db: Db): Promise<SpeciesRecord[]>`: all, active or not, sorted by Dutch name in Dutch order.
  - `createSpecies(db: Db, input: { dutchName: string; scientificName: string; needsVerification: boolean }, actor: AuditActor): Promise<{ outcome: "created"; species: SpeciesRecord } | { outcome: "name_taken"; field: "dutchName" | "scientificName" }>`
  - `updateSpecies(db: Db, input: { id: string; patch: { dutchName?: string; scientificName?: string; needsVerification?: boolean; active?: boolean } }, actor: AuditActor): Promise<{ outcome: "updated" | "unchanged"; species: SpeciesRecord } | { outcome: "not_found" } | { outcome: "name_taken"; field: "dutchName" | "scientificName" }>`
  - New `AuditAction`s: `"species.created"`, `"species.updated"`, `"species.deactivated"`, `"species.activated"`. `AuditSubject["type"]` gains `"species"`.
- Rules:
  - Names are normalized before they are compared or stored.
  - A unique-index violation (also from a concurrent insert) becomes `name_taken` with the field of the index that was hit; it is never thrown.
  - Audit entries have `organizationId: null` and subject `{ type: "species", id }`. `species.created` has details `{ dutchName, scientificName, needsVerification }`. `species.updated` has, for each changed field only, the old and new value (`dutchNameFrom`, `dutchNameTo`, and so on). A change of `active` is its own entry, `species.deactivated` or `species.activated`, without details. A patch that changes a name and `active` writes two entries.
  - A patch whose values all equal the stored ones is `unchanged`: no write, no entry, `updated_at` stays.

- [ ] **Step 1: Write the failing tests** (one `createTestDatabase()` per file; `const system = { kind: "system" } as const`).

```ts
test("a migrated database holds exactly the five official species, sorted by Dutch name", async () => {
  expect((await listSpecies(t.db)).map((s) => [s.id, s.dutchName, s.scientificName, s.needsVerification, s.active])).toEqual([
    [officialSpeciesIds.bruineKikker, "bruine kikker", "Rana temporaria", false, true],
    [officialSpeciesIds.gewonePad, "gewone pad", "Bufo bufo", false, true],
    [officialSpeciesIds.groeneKikker, "groene kikker", "Pelophylax esculentus synklepton", false, true],
    [officialSpeciesIds.kamsalamander, "kamsalamander", "Triturus cristatus", true, true],
    [officialSpeciesIds.kleineWatersalamander, "kleine watersalamander", "Lissotriton vulgaris", false, true],
  ]);
});
test("creates a species with one audit entry", async () => {
  const result = await createSpecies(t.db, { dutchName: " alpenwatersalamander ", scientificName: "Ichthyosaura  alpestris", needsVerification: true }, system);
  expect(result).toMatchObject({ outcome: "created", species: { dutchName: "alpenwatersalamander", scientificName: "Ichthyosaura alpestris", needsVerification: true, active: true } });
  // one entry: action species.created, organizationId null, subjectType "species", details { dutchName, scientificName, needsVerification }
});
test.each([["Gewone Pad", "Bufo novus", "dutchName"], ["gewone  pad ", "Bufo novus", "dutchName"], ["nieuwe pad", "BUFO BUFO", "scientificName"]])(
  "refuses %j / %j as name_taken on %s and stores nothing",
  async (dutchName, scientificName, field) => {
    expect(await createSpecies(t.db, { dutchName, scientificName, needsVerification: false }, system)).toEqual({ outcome: "name_taken", field });
    expect(await listSpecies(t.db)).toHaveLength(5);
  },
);
test("two creates of the same name at the same moment give one species", async () => {
  const input = { dutchName: "vuursalamander", scientificName: "Salamandra salamandra", needsVerification: true };
  const results = await Promise.all([createSpecies(t.db, input, system), createSpecies(t.db, input, system)]);
  expect(results.map((r) => r.outcome).sort()).toEqual(["created", "name_taken"]);
});
test("a rename keeps the old and the new value in the audit entry", async () => {
  await updateSpecies(t.db, { id: officialSpeciesIds.gewonePad, patch: { dutchName: "pad" } }, system);
  // entry: species.updated, details { dutchNameFrom: "gewone pad", dutchNameTo: "pad" } and nothing else
});
test("a patch that changes nothing is unchanged and writes no entry", async () => {
  const result = await updateSpecies(t.db, { id: officialSpeciesIds.gewonePad, patch: { dutchName: "gewone pad", active: true } }, system);
  expect(result.outcome).toBe("unchanged");
  expect(await t.db.select().from(auditLogEntries)).toHaveLength(0);
});
test("switching off and on writes species.deactivated and species.activated; twice off is unchanged", ...);
test("a rename to another species' name is name_taken", ...);
test("renaming a species to its own name in other capitals works", ...); // "Gewone pad": updated, no name_taken
test("an unknown id is not_found", ...);
test("a name with a capital is kept", ...); // "Italiaanse kamsalamander" stays as typed
// migrate.test.ts (add): the two migrations apply to a database that already holds users, organizations and audit entries
```

- [ ] **Step 2: Run them.** `pnpm test packages/db/src/species.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the schema, generate both migrations, fill the custom one, read the SQL,** then implement the functions.
- [ ] **Step 4: Run.** `pnpm db:migrate && pnpm check`. Expected: PASS. Then `docker compose exec db psql -U padvinder -d "$(grep '^DATABASE_URL' .env | sed 's|.*/||')" -c "select dutch_name from species order by 1"`. Expected: the five names.
- [ ] **Step 5: Commit.** `git commit -m "Add the species table with the five official species"`

---

### Task 2: The species contract, the permission and the endpoints

**Files:**

- Create: `packages/contracts/src/species.ts`, `packages/contracts/src/fixtures/species.ts`, `apps/api/src/routes/species.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/fixtures/index.ts`, `packages/contracts/src/errors.ts`, `apps/api/src/errors.ts`, `apps/api/src/permissions/rules.ts`, `apps/api/src/app.ts`
- Create (generated): the OpenAPI file and client
- Test: `packages/contracts/src/species.test.ts`, `apps/api/src/routes/species.test.ts`, `apps/api/src/permissions/rules.test.ts`

**Interfaces:**

- Consumes: Task 1's functions; `authorize`, `Permission`, `decide`; `apiError`, `errorResponses`; `createTestApp`, `createCast`, `expectStatuses`.
- Produces (contracts):
  - `speciesSchema` (component `Species`): `{ id: string; dutchName: string; scientificName: string; needsVerification: boolean; active: boolean }`
  - `speciesListResponseSchema` (component `SpeciesListResponse`): `{ species: Species[] }`
  - `speciesNameSchema`: a text, trimmed, 1 to 100 characters.
  - `createSpeciesRequestSchema` (component `CreateSpeciesRequest`): a strict object `{ dutchName, scientificName, needsVerification: boolean }` (all required).
  - `updateSpeciesRequestSchema` (component `UpdateSpeciesRequest`): a strict object with optional `dutchName`, `scientificName`, `needsVerification`, `active`, refined so that at least one key is present.
  - A new error code `nameTaken: "name_taken"` in `apiErrorCodes`.
  - Fixture `speciesFixture`: the five official species with their fixed IDs, plus one that is switched off ("vuursalamander", "Salamandra salamandra", needs the check).
- Produces (API):
  - `Permission` gains `{ action: "platform.manageSpecies" }`: `allowed` for a platform admin, `forbidden` for everyone else (never `hidden`: the list is not secret).
  - `ApiError` and `apiError` gain an optional fourth argument `issues: { path: string; message: string }[]`, which ends up in the body.
  - `GET /api/species` (operationId `listSpecies`): 200 for every logged-in user, 401 otherwise. All species, active or not.
  - `POST /api/species` (operationId `createSpecies`): 201 `Species`; 400; 401; 403; 409 `name_taken` with `issues: [{ path: "dutchName" | "scientificName", message }]`.
  - `PATCH /api/species/{speciesId}` (operationId `updateSpecies`): 200 `Species` for `updated` and `unchanged`; 400; 401; 403; 404; 409 as above.
  - The audit actor is `{ kind: "user", userId: request.actor.userId }`.
  - There is no `DELETE` route.

- [ ] **Step 1: Write the failing tests.**

```ts
// contracts species.test.ts
test.each([[{ dutchName: " ", scientificName: "X y", needsVerification: false }], [{ dutchName: "x".repeat(101), scientificName: "X y", needsVerification: false }], [{ dutchName: "x", scientificName: "X y" }], [{ dutchName: "x", scientificName: "X y", needsVerification: false, extra: 1 }]])(
  "create rejects %j",
  (body) => expect(createSpeciesRequestSchema.safeParse(body).success).toBe(false),
);
test("update rejects an empty body and an unknown key", ...);
test("every fixture parses", ...);

// rules.test.ts (add)
test("only a platform admin manages species; for others it is forbidden, not hidden", ...);

// routes/species.test.ts
const everyone = { platformAdmin: 200, organizationAdmin: 200, coordinator: 200, volunteer: 200, volunteerOtherGroup: 200, coordinatorOtherOrganization: 200, applicant: 200, anonymous: 401 };
test("every logged-in user reads the list", async () =>
  await expectStatuses(cast, everyone, (headers) => ctx.app.inject({ url: "/api/species", headers })));
const adminsOnly = (ok: number) => ({ platformAdmin: ok, organizationAdmin: 403, coordinator: 403, volunteer: 403, volunteerOtherGroup: 403, coordinatorOtherOrganization: 403, applicant: 403, anonymous: 401 });
test("only a platform admin creates", async () => {
  let n = 0;
  await expectStatuses(cast, adminsOnly(201), (headers) =>
    ctx.app.inject({ method: "POST", url: "/api/species", headers, payload: { dutchName: `testsoort ${n}`, scientificName: `Testus ${n++}`, needsVerification: false } }));
});
test("only a platform admin changes", async () =>
  await expectStatuses(cast, adminsOnly(200), (headers) =>
    ctx.app.inject({ method: "PATCH", url: `/api/species/${officialSpeciesIds.gewonePad}`, headers, payload: { needsVerification: false } })));
test("a taken name is 409 name_taken and says which field", async () => {
  const res = await post(cast.members.platformAdmin, { dutchName: "Gewone Pad", scientificName: "Bufo novus", needsVerification: false });
  expect(res.json()).toMatchObject({ statusCode: 409, code: "name_taken", issues: [{ path: "dutchName" }] });
});
test("a name of spaces or of 101 characters is 400", ...);
test("markup in a name is stored as typed", ...); // "<i>Bufo</i> x" comes back identical
test("the audit entry names the platform admin as actor", ...);
test("an unknown id is 404; an id that is not a UUID is 400", ...);
test("there is no way to delete a species", async () =>
  expect((await ctx.app.inject({ method: "DELETE", url: `/api/species/${officialSpeciesIds.gewonePad}`, headers: cast.members.platformAdmin.headers })).statusCode).toBe(404));
test("a POST from a foreign Origin is refused", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the species endpoints for platform admins"`

---

### Task 3: `packages/api-client`: species queries and messages

**Files:**

- Create: `packages/api-client/src/species.ts`
- Modify: `packages/api-client/src/index.ts`, `packages/api-client/src/error-messages.ts` _(from the joining plan)_
- Test: `packages/api-client/src/species.test.ts`, `packages/api-client/src/error-messages.test.ts`

**Interfaces:**

- Consumes: the generated `listSpecies`, `listSpeciesQueryKey`, `createSpecies`, `updateSpecies`; `apiErrorCode`, `apiErrorMessage` _(from the joining plan)_.
- Produces:
  - `useSpecies()`: the list query.
  - `useCreateSpecies()`, `useUpdateSpecies()`: mutations that throw the API's error body and refetch the list on success.
  - `apiErrorIssues(error: unknown): { path: string; message: string }[]`: the `issues` of an error body, or an empty list.
  - `apiErrorMessage` gains `name_taken`: `Deze naam bestaat al.`
  - `speciesNameTakenMessage(field: string): string`: `Er is al een soort met deze Nederlandse naam.` for `dutchName`, `Er is al een soort met deze wetenschappelijke naam.` for `scientificName`.

- [ ] **Step 1: Write the failing tests** (`mockFetch`, `speciesFixture`).

```ts
test("useSpecies loads the list", ...);
test("creating refetches the list", ...);
test("a 409 surfaces with its code and the field", async () => {
  // mock 409 { code: "name_taken", issues: [{ path: "scientificName", message: "x" }] }
  expect(apiErrorCode(error)).toBe("name_taken");
  expect(apiErrorIssues(error)).toEqual([{ path: "scientificName", message: "x" }]);
});
test("apiErrorIssues is empty for a network failure", ...);
test("the two name-taken texts", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add species queries to the API client"`

---

### Task 4: `packages/ui`: table, modal, toast and checkbox

**Files:**

- Create: shadcn `table`, `dialog`, `sonner` and `checkbox` under `packages/ui/src/components/ui/`; `packages/ui/src/components/modal.tsx`, `modal.stories.tsx`, `packages/ui/src/components/toast.tsx`, `packages/ui/src/lib/text.ts`
- Modify: `packages/ui/src/index.ts`, `packages/ui/package.json`
- Create (generated): reference images for the new stories
- Test: `packages/ui/src/components/modal.test.tsx`, `packages/ui/src/lib/text.test.ts`

**Interfaces:**

- Produces (from `@padvinder/ui`):
  - `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` (shadcn's, re-exported).
  - `Checkbox` (shadcn's, re-exported).
  - `Modal(props: { open: boolean; title: string; onClose(): void; children: ReactNode })`: a dialog with the title and a cross in its corner (accessible name `Sluiten`). It closes, by calling `onClose`, through the cross, the Escape key and a click beside it. It has no button row of its own: the content brings its buttons. The spec's request modal (a later plan) uses this component.
  - `Toaster` (rendered once per app) and `showToast(message: string): void`.
  - `capitalizeFirst(text: string): string`: the first letter in upper case, the rest unchanged; an empty text stays empty.
- The `ConfirmDialog` _(from the joining plan)_ stays what it is: a question with two buttons. `Modal` is for forms and details.
- Stories for `Modal`: Open (with a short form inside), LongContent (it scrolls inside the dialog).

- [ ] **Step 1: Write the failing tests.**

```tsx
test("closes by the cross, by Escape and by a click beside it", async () => {
  // each calls onClose exactly once
});
test("renders nothing when closed", ...);
test("the cross is named Sluiten", ...);
test.each([["gewone pad", "Gewone pad"], ["Italiaanse kamsalamander", "Italiaanse kamsalamander"], ["", ""], ["éénstreep", "Éénstreep"]])(
  "capitalizeFirst(%j) is %j",
  (input, expected) => expect(capitalizeFirst(input)).toBe(expected),
);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Add the shadcn components** (follow AGENTS.md's shadcn notes after each `shadcn add`), then implement.
- [ ] **Step 4: Run.** `pnpm check && pnpm storybook:build && pnpm screenshots:update && pnpm test:visual:docker`. Expected: PASS, with new reference images to commit.
- [ ] **Step 5: Commit.** `git commit -m "Add table, modal, toast and checkbox to the ui package"`

---

### Task 5: `packages/ui`: the species table and form

**Files:**

- Create: `packages/ui/src/components/species/species-table.tsx`, `species-form.tsx`, a `.stories.tsx` next to each
- Modify: `packages/ui/src/index.ts`
- Create (generated): reference images
- Test: next to each file

**Interfaces:**

- Consumes: `Species` and `speciesFixture` (Task 2); Task 4's components.
- Produces (from `@padvinder/ui`):
  - `SpeciesTable(props: { species: Species[]; onEdit(id: string): void; onSetActive(id: string, active: boolean): void })`
  - `type SpeciesFormValues = { dutchName: string; scientificName: string; needsVerification: boolean }`
  - `SpeciesForm(props: { mode: "create" | "edit"; initial?: SpeciesFormValues; onSubmit(values: SpeciesFormValues): void; pending: boolean; fieldErrors?: { dutchName?: string; scientificName?: string }; error?: string })`
- Exact copy:
  - Table columns: `Nederlandse naam`, `Wetenschappelijke naam`, `Betrouwbaarheidscheck`, `Actief`, and a last column without a heading for the actions. The Dutch name is shown with `capitalizeFirst`; the scientific name in italics; the two yes/no columns as `ja` or `nee`. Actions per row: `Wijzig`, and `Zet uit` or `Zet aan`. A species that is off has muted text in its whole row. The table keeps the order it is given.
  - Form fields: `Nederlandse naam`, `Wetenschappelijke naam`, and a checkbox `Betrouwbaarheidscheck nodig` with below it `Voor zeldzame of beschermde soorten.` Button `Bewaar`; while pending `Even geduld…`, disabled.
  - Hint in create mode, above the fields: `Schrijf de naam zoals in een zin, bijvoorbeeld "gewone pad".`
  - Note in edit mode, above the fields: `Wijzig een naam alleen om een fout te herstellen. Voeg voor een andere soort een nieuwe soort toe.`
  - An empty name (after trimming): `Vul een naam in.` under that field, and no call of `onSubmit`. A name over 100 characters: `Een naam mag hoogstens honderd tekens hebben.`
  - `fieldErrors` show under their field; `error` above the button.
- Stories: table (Default with `speciesFixture`, which includes one that is off); form (Create, Edit, Pending, NameTaken, WithError).

- [ ] **Step 1: Write the failing tests.**

```tsx
test("shows the Dutch name with a capital and the scientific name in italics", () => {
  render(<SpeciesTable species={speciesFixture} onEdit={noop} onSetActive={noop} />);
  expect(screen.getByText("Gewone pad")).toBeVisible();
  expect(screen.getByText("Bufo bufo").tagName).toBe("EM");
});
test("Zet uit calls onSetActive(id, false); a species that is off offers Zet aan", ...);
test("markup in a name is shown as text", ...); // "<i>x</i>" is visible literally
test("the form trims and submits the three values", ...);
test("an empty name shows the text and does not submit", ...);
test("a name of 101 characters shows the text and does not submit", ...);
test("edit mode starts with the initial values and shows the note", ...);
test("a field error shows under its field", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm screenshots:update && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the species table and form components"`

---

### Task 6: The portal's layout and navigation

**Files:**

- Create: `apps/portal/src/layout/navigation.ts`, `apps/portal/src/layout/portal-layout.tsx`, `apps/portal/src/pages/not-found-page.tsx`
- Modify: `apps/portal/src/router.tsx`, `apps/portal/src/pages/home-page.tsx`, `apps/portal/src/pages/system-page.tsx`, `apps/portal/src/main.tsx`
- Test: `apps/portal/src/layout/navigation.test.ts`, `apps/portal/src/layout/portal-layout.test.tsx`, `apps/portal/src/pages/home-page.test.tsx`, `apps/portal/src/router.test.ts`

**Interfaces:**

- Consumes: `useMe`, `useLogOut`, `useAccessLiveUpdates` _(from the joining plan)_; `Toaster`.
- Produces:
  - `type NavItem = { label: string; to: string }`
  - `navigationFor(me: MeResponse): NavItem[]`. In this plan: for a platform admin `[{ label: "Soorten", to: "/species" }, { label: "Systeemstatus", to: "/system" }]`, for everyone else an empty list. The later plans of this part add their items here, in the order of the spec's navigation table.
  - `managesSomething(me: MeResponse): boolean`: a platform admin, an organization admin, or a coordinator of at least one group.
  - `PortalLayout`: the layout route inside the auth gate. A header with `PadVinder`, the navigation as links (the current one marked by more than color), the user's name, and the button `Log uit`. Below it the page. It renders `Toaster` once and calls `useAccessLiveUpdates()`, so the navigation follows a change of rights without a reload.
  - `RequirePlatformAdmin({ children })`: renders `NotFoundPage` for anyone who is not a platform admin.
  - Routes: `/` (home), `/species` (Task 7), `/system`, and `*` (not found). `/system` moves inside `RequirePlatformAdmin`, replacing its own "Je hebt geen toegang" text: a page someone may not see looks like a page that does not exist.
- Exact copy:
  - Home, for someone with navigation items: go straight to the first item.
  - Home, for someone who manages something but has no item yet (an organization admin or coordinator, until the next plans): `Hier is nog niets te doen. Het beheer komt binnenkort.`
  - Home, for someone who manages nothing: `Het portaal is voor coördinatoren en beheerders. Tellen doe je in de app.` and a link `Open de app` to `/app/` (a plain link: the app is another page load).
  - Not found: heading `Deze pagina bestaat niet`, text `Of je mag haar niet zien.`, link `Terug naar het begin` to `/`.

- [ ] **Step 1: Write the failing tests.**

```tsx
test("navigationFor", () => {
  expect(navigationFor(platformAdminMeFixture).map((i) => i.to)).toEqual(["/species", "/system"]);
  expect(navigationFor(coordinatorMeFixture)).toEqual([]);
  expect(navigationFor(meFixture)).toEqual([]);
});
test("managesSomething", () => {
  expect(managesSomething(coordinatorMeFixture)).toBe(true);
  expect(managesSomething(meFixture)).toBe(false);
  expect(managesSomething(applicantMeFixture)).toBe(false);
});
test("the layout shows the items, the name and Log uit", ...);
test("home sends a platform admin to /species", ...);
test("home tells a volunteer the portal is not for them, with a link to /app/", ...);
test("home tells a coordinator there is nothing yet", ...);
test("a volunteer who opens /system sees the not-found page", ...);
test("an unknown address shows the not-found page", ...);
test("when me changes to a platform admin, the items appear without a reload", ...);
// replace the me cache by platformAdminMeFixture, as access-changed would
test("when a platform admin loses the flag, an open /system turns into not found", ...);
test("no portal route starts with /app or /api", ...); // the existing test still passes
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Give the portal a layout with navigation by role"`

---

### Task 7: The species page

**Files:**

- Create: `apps/portal/src/pages/species-page.tsx`
- Modify: `apps/portal/src/router.tsx`
- Test: `apps/portal/src/pages/species-page.test.tsx`

**Interfaces:**

- Consumes: Tasks 3, 4, 5 and 6; `ConfirmDialog` _(from the joining plan)_.
- Produces: `/species`, inside `RequirePlatformAdmin`. Heading `Soorten`, a button `Nieuwe soort`, and `SpeciesTable`.
  - `Nieuwe soort` and `Wijzig` open `SpeciesForm` in a `Modal` titled `Nieuwe soort` or `Soort wijzigen`. On success the modal closes and a toast says `{Naam} is toegevoegd.` or `{Naam} is gewijzigd.` (the Dutch name with a capital).
  - A 409 keeps the modal open and puts `speciesNameTakenMessage(field)` under the field named in the error's `issues`. Any other failure shows `apiErrorMessage(code)` above the button.
  - `Zet uit` asks first, with `ConfirmDialog`: title `{Naam} uitzetten?`, text `Vrijwilligers kunnen deze soort dan niet meer kiezen. Eerdere tellingen blijven bewaard.`, confirm `Zet uit`. Then the toast `{Naam} staat uit.` `Zet aan` does not ask; its toast is `{Naam} staat aan.`
  - Loading: `Soorten laden…`. A failed load: `Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.` with `Probeer opnieuw`.

- [ ] **Step 1: Write the failing tests** (`mockFetch`, the me cache set to `platformAdminMeFixture`).

```tsx
test("shows the species in the given order", ...);
test("adding a species closes the modal, shows the toast and refetches", ...);
test("a taken scientific name keeps the modal open with the text under that field", ...);
test("editing starts with the species' values", ...);
test("Zet uit asks first; Annuleer changes nothing; confirming sends active false", ...);
test("Zet aan sends active true without asking", ...);
test("a volunteer sees the not-found page and no request for species is needed for that", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and look.** `pnpm check`. Then `pnpm dev`, log in on the portal as `hoofdbeheerder@example.test` (the code is in the Mailpit inbox), add a species, rename it, switch it off and on. Save a screenshot of the page to `.context/species-page.png`.
- [ ] **Step 5: Commit.** `git commit -m "Add the species page to the portal"`

---

### Task 8: End-to-end test and documentation

**Files:**

- Create: `e2e/portal-species.spec.ts`
- Modify: `playwright.config.ts` (a project with a laptop-sized browser for the portal, if there is none yet), `AGENTS.md`

**Interfaces:**

- Consumes: `newAddress`, `createSession`, `runAdmin` (the e2e helpers of part 1).
- The portal runs on its own dev server (`PORTAL_PORT`); the test goes to `http://localhost:${PORTAL_PORT}/`. Sessions made with `createSession` work there too: the cookie is for `localhost`, whatever the port.
- A species cannot be deleted, so every run leaves its test species behind. The test names them `e2e-soort <8 random letters>` and `Testus <8 random letters>` and switches them off at the end, so they do not clutter a developer's list.

- [ ] **Step 1: Write the tests.**

```ts
test("a platform admin adds, renames and switches off a species", async ({ page, context }) => {
  const address = newAddress("soorten");
  runAdmin("grant-platform-admin", "--email", address);
  await createSession(context, address);
  await page.goto(`${portal}/`);
  await expect(page).toHaveURL(/\/species$/);
  await expect(page.getByText("Gewone pad")).toBeVisible();
  await page.getByRole("button", { name: "Nieuwe soort" }).click();
  // fill both names, Bewaar; the toast "… is toegevoegd." shows and the row is in the table
  // Wijzig: change the Dutch name; the toast "… is gewijzigd." shows
  // Zet uit, confirm; the row shows "nee" under Actief
});
test("a taken name shows the text under the field", ...);
// Nieuwe soort with "gewone pad": "Er is al een soort met deze Nederlandse naam."
test("a volunteer sees that the portal is not for them", async ({ page, context }) => {
  await createSession(context, newAddress("vrijwilliger"));
  await page.goto(`${portal}/`);
  await expect(page.getByText("Het portaal is voor coördinatoren en beheerders.")).toBeVisible();
  await page.goto(`${portal}/species`);
  await expect(page.getByRole("heading", { name: "Deze pagina bestaat niet" })).toBeVisible();
});
```

- [ ] **Step 2: Run.** `pnpm test:e2e` three times. Expected: PASS each time.
- [ ] **Step 3: Update `AGENTS.md`.**
  - Current state: the portal has a layout and the species page.
  - Under the architecture rules: the species list is one list for all organizations, managed by platform admins, and the one domain table that is not scoped by organization; the first five came from a migration that is never edited; a species is switched off, never deleted. Remove "The species list is not in the skeleton."
  - The portal: `navigationFor` is the one place that decides which items someone sees; a page someone may not see renders the not-found page (`RequirePlatformAdmin`); `Modal` is for forms and details, `ConfirmDialog` for a question; results show with `showToast`.
  - The API: `apiError` can carry `issues` to point at a field; `name_taken`.
  - Tests: an end-to-end test of the portal goes to `PORTAL_PORT`.
- [ ] **Step 4: Check the CI rules.** If this plan added a file that the `visual`, `e2e` or `release` jobs depend on outside the paths in `scripts/lib/ci-jobs.ts`, add it to the rules and their test (AGENTS.md, "CI").
- [ ] **Step 5: Run everything.** `pnpm check && pnpm build && pnpm test:e2e && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Add the species end-to-end test and document the portal shell"`

## Deviations

Recorded while building, 25 November 2026. One line each: what, and why.

- Names from the joining plan: `apiErrorMessage`, `connectionMessage` and the new texts (`name_taken`, `speciesNameTakenMessage`) live in `packages/ui/src/lib/messages.ts`, not `packages/api-client/src/error-messages.ts`; `apiErrorIssues` sits next to `apiErrorCode` in `packages/api-client/src/error-messages.ts`. That is where the real code keeps them.
- Task 1: `recordAudit` refuses every details key that contains `name`, so `audit-log.ts` exports `THING_NAME_AUDIT_KEYS`, the exact keys allowed although they contain `name` because they hold the name of a thing, never of a person (the six species keys). Every other such key, and every text value with an `@`, is still refused. Asked for by the maintainer's session.
- Task 1: the species tests count audit entries per subject instead of in the whole table, and use their own species for changes, because one test database per file and the append-only log make whole-table counts depend on test order.
- Task 1: the table migration is called `species`; the "official list, not scoped by organization" note is a code comment in `schema/species.ts` and an SQL comment in the custom migration, not `COMMENT ON TABLE`.
- Task 2: a species name may not contain `@` (400 `invalid_request`), because `recordAudit` refuses an `@` in a value and would otherwise make it a 500. The form refuses it too, with "Een naam mag geen @ bevatten."
- Task 2: `apiErrorBody` takes the optional `issues` as well as `apiError`, so the error handler builds the body in one place.
- Task 2: the switched-off "vuursalamander" in `speciesFixture` has a made-up fixed ID; the plan gives none.
- Task 3: the hook test is `species.test.tsx` (it holds JSX) and mocks fetch through `client.setConfig`, as `me-query.test.ts` does. `speciesNameTakenMessage` gives "Deze naam bestaat al." for an unknown field.
- Task 4: inline SVG icons instead of `lucide-react`, which the repository does not use; the cross is a 44 px `DialogCloseButton` named "Sluiten"; shadcn's English "Close" footer option and the animation classes are removed; sonner's `next-themes` import is removed (fixed light theme); `sonner` is a dependency of `packages/ui` only, like `radix-ui`.
- Task 5: the scientific name gets the same checks as the Dutch name; a `ResizeObserver` stub in `packages/ui/vitest.setup.ts` for the Radix checkbox under jsdom.
- Task 5: the visual tests run in a 390×844 phone viewport, which cut the species table to two columns. A story can now ask for a wider viewport with the parameter `visualViewport` (`stories.visual.test.tsx`); the table story uses 1024×768.
- Task 6: three extra files: `layout/require-platform-admin.tsx`, the test helper `testing/render-portal.tsx`, and a global `FakeEventSource` in `apps/portal/vitest.setup.ts`, because the layout opens the event stream in every portal test. The rights-change tests send a real `access-changed` event instead of writing the me cache.
- Task 7: `dismissAllToasts()` in `@padvinder/ui`, called after each portal test, because sonner keeps toasts between tests; a `ResizeObserver` stub in `apps/portal/vitest.setup.ts`. A failed "Zet uit" shows its text in the dialog, a failed "Zet aan" as a toast.
- Task 8: the volunteer test makes a real volunteer (`makeVolunteer`) instead of using a fresh address, which would be an applicant; both see the same text, and the test's name says volunteer.
- Task 8: the portal tests run in a second Playwright project, `portal` (Desktop Chrome, 1280×800, `baseURL` on `PORTAL_PORT`, only `portal-*.spec.ts`), and a second `webServer` entry waits until the portal's dev server answers, so they go to `/` and `/species` instead of `${portal}/`.
- Task 8: AGENTS.md gets a "Species" section under the architecture rules and a glossary row for "betrouwbaarheidscheck" (`needsVerification`), which the glossary did not have. The CI rules needed no change: the files this plan added are all under paths the rules already cover.
- Task 8: the first test checks "Gewone pad" as a table cell (`getByRole("cell", exact)`) rather than `getByText`, so it cannot match a test species or a toast.
