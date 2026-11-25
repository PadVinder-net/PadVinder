# Organizations, Working Groups and Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pull request 2 of "Portal administration": a platform admin creates organizations and appoints their admins, an organization admin creates and changes working groups and appoints coordinators, all in the portal, and no organization is ever left without an admin or an active working group without a coordinator.

**Architecture:** The administration functions in `packages/db/src/admin.ts` stay the one place where organizations, working groups and roles change; the command-line tool, the seed, the test cast and the new portal endpoints all call them. Creating an organization or working group makes its first admin or coordinator in the same transaction. "Never the last one" is checked under a row lock on the organization or working group, by every function that can take an admin or coordinator away. The permission module gets the organization as a second kind of target. The portal gets pages for working groups and organizations on the layout of the previous pull request.

**Tech Stack:** The existing stack, plus shadcn/ui's `dropdown-menu` and `select`.

**Spec:** `docs/superpowers/specs/2026-11-22-portal-administration-design.md` (read it, the design of part 1 `2026-11-21-accounts-and-access-design.md`, and `AGENTS.md` before starting any task). This plan covers item 2 under "Order of work".

**Builds on:** `2026-11-22-portal-shell-and-species.md`, merged as pull request 21; branch from `main`. Read the "Deviations" at the end of that plan: they say how the species page was really built, and this plan follows the same patterns.

**Moved into this plan from item 3 of the spec's order of work:** `users.last_login_at` and everything under "Who has logged in" (Task 1). The rule on who may be a first coordinator needs "has this address ever been used", so it cannot wait for the next pull request.

**Added at the maintainer's request (25 November 2026):** the subject of every mail from staging starts with `[STAGING] ` (Task 13). It is not part of portal administration; it is here because this is the next pull request to be built.

**Left for the next plan (item 3):** adding people by email address, removing the account of a removed person who never logged in, the mails to an appointed organization admin and to a first coordinator, the requests page, and the navigation item "Aanmeldingen". This plan sends no mail: whoever appoints someone tells them, until the next pull request adds the mails to these same endpoints.

## Global Constraints

- AGENTS.md applies in full: English code, Dutch UI copy with "je", English kebab-case URL paths, glossary terms, naming per location, generated files never edited by hand.
- Run `pnpm check` before every commit (it includes `check:generated`). After any change to a route or contract run `pnpm api:generate`; after any schema change run `pnpm db:generate`. Commit the generated files.
- Every new or changed story needs its reference image: run `pnpm screenshots:update` (Docker; never on the host) and commit the images.
- Routes reach the user only through `request.actor` and decide only through `authorize` or `decide`. Every endpoint behind a permission has one `expectStatuses` test with the standard cast.
- Answers: 401 without a login; 404 for what the actor may not see at all, which includes an organization they do not administer, also when they are a member of one of its working groups; 403 for what they may see but not change; 409 for a conflict. Error bodies follow `apiErrorSchema`; the portal chooses the Dutch text from `code` and never shows `message`.
- `PATCH` takes a strict, partial object: absent keys stay, `null` empties a field that may be empty, unknown keys and an empty body are 400. The same body twice gives the same result and writes one audit entry.
- A change, its audit entry (`recordAudit`) and its live events go in one transaction. Audit details never hold a name of a person, an email address or a phone number. The names of organizations and working groups are fine; an organization's contact address is never stored in the log.
- An organization always has at least one admin, and an active working group at least one coordinator. An admin or coordinator who never logged in counts. An inactive working group may be without a coordinator.
- A response never contains a field the actor may not see. Leave the key out. Tests check the raw JSON.
- IDs of organizations, working groups, memberships and admin rows are made by the server: these are not writes from the field.
- The API stays backward compatible: only add fields to existing responses.
- Sort Dutch names with `COLLATE "nl-NL-x-icu"`.
- Fixtures, seed data and test addresses are made up and end in `@example.test`.
- A name or a city may not contain `@`: `recordAudit` refuses an `@` in a value, and a name that holds one would otherwise become a 500. The API answers 400 and the forms say `Een naam mag geen @ bevatten.` or `Een plaats mag geen @ bevatten.`, as the species form does.
- The portal pages follow the species page: a dialog cannot be closed while its save runs; an edit sends only the fields that changed, and a save without changes closes the dialog with no request and no toast; a failed action shows its text inside its dialog, or as a toast when it has none.
- A story of a table asks for a wide viewport with the story parameter `visualViewport` (1024×768), as the species table does.
- Dutch copy in this plan is exact. Where a small text is missing, write it in the same style.
- Commit after every task with a message in English, ending with the co-author line your session's instructions give. Do not push after every commit.

Dutch texts used in more than one task:

| Code or situation                        | Text                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `last_organization_admin`                | `Een organisatie heeft altijd een beheerder. Maak eerst iemand anders beheerder.`                                                 |
| `last_coordinator`                       | `Een werkgroep heeft altijd een coördinator. Maak eerst iemand anders coördinator.`                                               |
| `no_coordinator`                         | `Deze werkgroep heeft geen coördinator. Maak eerst iemand coördinator.`                                                           |
| `person_outside_organization`            | `Deze persoon heeft al een account buiten {organisatie}. Kies iemand anders of word eerst zelf coördinator.`                      |
| A taken organization name                | `Er is al een organisatie met deze naam.`                                                                                         |
| A taken working group name               | `Er is al een werkgroep met deze naam.`                                                                                           |
| Not an email address                     | `Vul een geldig e-mailadres in.`                                                                                                  |
| A person who never logged in             | `(nog niet ingelogd)`                                                                                                             |
| A person who logged in, without a name   | `(nog geen naam)`                                                                                                                 |
| Own account, only coordinator, contact   | `Je bent de enige coördinator van {werkgroep}. Vraag {contactadres} om eerst iemand anders coördinator te maken.`                 |
| Own account, only coordinator, none      | `Je bent de enige coördinator van {werkgroep}. Vraag de beheerder van {organisatie} om eerst iemand anders coördinator te maken.` |
| Own account, only admin, contact address | `Je bent de enige beheerder van {organisatie}. Vraag {contactadres} om eerst iemand anders beheerder te maken.`                   |
| Own account, only admin, none            | `Je bent de enige beheerder van {organisatie}. Vraag een hoofdbeheerder om eerst iemand anders beheerder te maken.`               |

## Review Focus

1. **Two people take the last two away at the same moment.** Two coordinators of one group each lose the role, are removed, or delete their account in the same instant; two admins of one organization likewise. Exactly one goes through, the other gets 409, and one always remains. Pinned in Task 2, Task 3 and Task 4.
2. **The same form is sent twice,** or the same name in another shape (`Paddentrek Enschede`, `paddentrek  enschede `). One organization or working group, the second answer is 409 `name_taken`, never a 500 and never a second first admin. Pinned in Task 2, Task 3 and Task 6.
3. **An address that is not what the form hoped for:** capitals and spaces around it, not an address at all, the replaced address of a deleted account, the address of someone with a profile in another organization. The first reaches the same account; the others are refused with a text under the field, and nothing is created. Pinned in Task 2, Task 3 and Task 9.
4. **A working group that is switched off.** Its last coordinator may be removed; it cannot be switched on without a coordinator; someone can be made coordinator while it is off; its members lose it from `/api/me` and get it back. Pinned in Task 3 and Task 7.
5. **Rights change while the portal is open.** An admin loses the role with a working group's page open, or a group is switched off under a coordinator: the page turns into the not-found text and the navigation follows, without a reload. Pinned in Task 11 and Task 12.

---

### Task 1: Who has logged in

**Files:**

- Modify: `packages/db/src/schema/auth.ts`, `apps/api/src/auth/auth.ts`, `packages/db/src/members.ts`, `packages/contracts/src/members.ts`, `packages/contracts/src/fixtures/members.ts`, `apps/api/src/testing/login.ts` (only if `loginAs` bypasses the hook)
- Create (generated): one migration for the column; one custom migration for the backfill (`pnpm --filter @padvinder/db exec drizzle-kit generate --custom --name backfill_last_login_at`); the OpenAPI file and client
- Test: `apps/api/src/auth/login.test.ts`, `packages/db/src/members.test.ts`, `apps/api/src/routes/members.test.ts`, `packages/db/src/migrate.test.ts`

**Interfaces:**

- Produces (column): `users.last_login_at timestamptz`, nullable. Ours, like `phone`: declared in Better Auth's `additionalFields` with `input: false`.
- The custom migration sets it, for every user, to the `created_at` of their newest session; a user without a session keeps `null`.
- Every successful login sets it to the moment of the login. Better Auth has a database hook that runs after a session is made; look it up for 1.7.27 before you use it. Being added, being given a role, and a session that is only renewed do not set it.
- Produces (from `@padvinder/db`): `userHasLoggedIn`, the SQL expression `users.last_login_at is not null`, typed as a boolean, for every query that returns `hasLoggedIn`.
- Produces (contract): `Member` gains `hasLoggedIn: boolean`, optional, present exactly when `email` is (`listMembers` with `contact: true`).
- Fixture: `membersWithContactFixture` gets `hasLoggedIn: true`, and a fourth member in both fixtures who never logged in (name `""`, `hasLoggedIn: false`, `email: "nieuw@example.test"`, `phone: null`).

- [ ] **Step 1: Write the failing tests.**

```ts
// login.test.ts (add)
test("a login sets last_login_at; a second login moves it", ...);
test("an account made by the admin tool has no last_login_at until its first login", ...);
// grantCoordinator for a new address: null; after loginAs: set
// members.test.ts (db, add)
test("with contact, a member carries hasLoggedIn; without, the key is absent", ...);
// routes/members.test.ts (add)
test("a volunteer's raw response has no hasLoggedIn key", ...);
// migrate.test.ts (add): a database migrated up to the previous migration, holding two users, one with two sessions:
// after migrating, that user's last_login_at equals the newer session's created_at, the other's is null
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm db:generate` and `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm db:migrate && pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Record when a user last logged in"`

---

### Task 2: An organization always has an admin

**Files:**

- Create: `packages/contracts/src/email.ts`, `packages/db/src/organizations.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/db/src/schema/organizations.ts`, `packages/db/src/admin.ts`, `packages/db/src/audit-log.ts`, `packages/db/src/index.ts`, `packages/db/src/seed.ts`, `apps/api/src/cli/run-admin-command.ts`, `apps/api/src/testing/cast.ts`, `e2e/helpers/working-groups.ts`, and every test that calls `createOrganization` or `expectStatuses`
- Create (generated): a migration
- Test: `packages/contracts/src/email.test.ts`, `packages/db/src/admin.test.ts`, `packages/db/src/organizations.test.ts`, `packages/db/src/seed.test.ts`, `apps/api/src/cli/run-admin-command.test.ts`, `apps/api/src/testing/cast.test.ts`, `packages/db/src/migrate.test.ts`

**Interfaces:**

- Produces (contracts): `emailAddressSchema`: a text whose surrounding spaces are removed and capitals lowered before it is checked, an email address of at most 254 characters, and not one that ends in `@deleted.invalid`. `isEmailAddress(text: string): boolean` uses it. This is the one rule for an address someone types into an administration form; `parseEmail` in `admin.ts` uses it too, and the next plan's form for adding people does. Check how the schema shows in the generated OpenAPI file before you settle its construction.
- Produces (schema): `organizations.contact_email text`, nullable. A unique index `organizations_name_key` on `lower(name)`. The migration fails on a database that holds two organizations whose names differ only in capitals; that is intended, and the pull request description says so.
- Produces (from `@padvinder/db`), changed:
  - `normalizeName(name: string): string`: trims and turns every run of whitespace into one space. Organization and working group names and cities are normalized with it before they are compared or stored.
  - `createOrganization(db: Db, input: { name: string; adminEmail: string; contactEmail?: string | null }, actor: AuditActor): Promise<{ id: string; adminUserId: string; adminCreated: boolean }>`. One transaction: the organization, the admin's account when there is none, the admin row, the entries `organization.created` and `role.organization_admin_granted`, and `access-changed` for the admin. Throws `AdminError` `name_taken`, `invalid_email`, or `user_not_found` (the replaced address of a deleted account); then nothing is written.
  - `updateOrganization(db: Db, input: { organizationId: string; patch: { name?: string; contactEmail?: string | null } }, actor: AuditActor): Promise<{ changed: boolean }>`. Throws `organization_not_found`, `name_taken`. A patch that changes nothing writes nothing. One entry `organization.updated`, with `organizationNameFrom` and `organizationNameTo` when the name changed and `contactChanged: true` when the contact address changed; the address itself is never in the entry.
  - `revokeOrganizationAdmin` (by address, the tool) and new `removeOrganizationAdmin(db: Db, input: { organizationId: string; userId: string }, actor: AuditActor): Promise<{ changed: boolean }>` (by ID, the portal; `changed: false` when that user is no admin there). Both throw `last_organization_admin` when no other admin of the organization would remain.
  - `lockOrganization(tx: DbTransaction, organizationId: string): Promise<boolean>`: a row lock on the organization (`for no key update`, so inserts that reference the organization do not wait), held until the transaction ends; `false` when there is none. Every function that removes an admin row takes it before it counts.
  - New `AdminErrorCode`s: `last_organization_admin`. New `AuditAction`: `organization.updated`.
  - `THING_NAME_AUDIT_KEYS` in `audit-log.ts` gains `organizationNameFrom`, `organizationNameTo`, `workingGroupNameFrom`, `workingGroupNameTo`.
- Produces (from `@padvinder/db`, `organizations.ts`), with types inferred from the contracts of Task 6 once they exist (until then, local types of the same shape):
  - `listAdministeredOrganizations(db: Db, access: Pick<Access, "isPlatformAdmin" | "adminOfOrganizationIds">): Promise<{ id: string; name: string; contactEmail: string | null }[]>`: all for a platform admin, otherwise those in `adminOfOrganizationIds`; sorted by name in Dutch order.
  - `getOrganization(db: Db, organizationId: string): Promise<{ id: string; name: string; contactEmail: string | null; admins: { userId: string; name: string; email: string; hasLoggedIn: boolean }[] } | null>`: admins sorted by name in Dutch order, deleted accounts left out.
- The command-line tool: `create-organization --name <name> --admin-email <address> [--contact-email <address>]`. It prints the new ID on the first line and, when it made an account, `new account for <address>` on a second line. `revoke-organization-admin` refuses the last admin with one clear line. `list` marks an organization without an admin with `[no admin]`.
- The seed: both organizations are made with an admin, and an organization that exists already gets its admin (the grant is idempotent). "Paddentrek Voorbeeldstad": admin `beheerder@example.test`, contact address `contact-voorbeeldstad@example.test`. "Paddenwerkgroep Fictiefdorp": admin `beheerder-fictiefdorp@example.test` ("Fenna Fictief"), no contact address. The seed sets `last_login_at` (only when it is empty) for every person it gives a name, so local lists look like real use.
- The test cast: `Cast.members` gains `organizationAdminOtherOrganization`, the admin of `otherOrganization`; `organization` is made with `organizationAdmin` as its admin. Every `expectStatuses` call names the new member: add the status that follows from the rules (for a record of `organization`, what `coordinatorOtherOrganization` gets).
- `e2e/helpers/working-groups.ts`: `createWorkingGroup()` passes `--admin-email` with a fresh address from `newAddress`, reads the ID from the first line, and returns the address as `adminAddress`.

- [ ] **Step 1: Write the failing tests** (a fresh test database where audit entries are counted).

```ts
// email.test.ts
test.each([[" Noor@Example.TEST ", "noor@example.test"]])("%j becomes %j", ...);
test.each(["jan@", "jan", "", "a@b", `${"x".repeat(250)}@example.test`, "deleted-123@deleted.invalid"])("%j is refused", ...);

// admin.test.ts
test("creating an organization makes its admin in the same transaction", async () => {
  const result = await createOrganization(t.db, { name: "Paddentrek Voorbeeldstad", adminEmail: " Bram@Example.test " }, system);
  // result.adminCreated is true; one organization, one user bram@example.test, one admin row;
  // entries organization.created and role.organization_admin_granted, both with this organizationId
});
test.each(["jan@", "deleted-0192f3c0-0000-7000-8000-000000000001@deleted.invalid"])(
  "an organization is not created with the admin address %j", ...); // throws AdminError; no organization, no entry
test.each(["Paddentrek Voorbeeldstad", "paddentrek  voorbeeldstad "])("the name %j is taken", ...);
test("two creates of the same name at the same moment give one organization and one admin row", ...);
test("the last admin cannot be removed; with a second one it works", ...);
// removeOrganizationAdmin and revokeOrganizationAdmin both: AdminError last_organization_admin, the row stays
test("two admins removing each other at the same moment leave one", async () => {
  const results = await Promise.allSettled([remove(a), remove(b)]);
  // one fulfilled with changed true, one rejected with last_organization_admin; one admin row left
});
test("an admin who never logged in counts as an admin", ...);
test("a rename writes the old and new name; a contact change writes contactChanged and no address", ...);
// the details of organization.updated never contain an "@"
test("a patch that changes nothing writes no entry", ...);
// organizations.test.ts
test("a platform admin lists all organizations, an admin their own, a coordinator none", ...);
test("getOrganization lists the admins by name, without deleted accounts", ...);
// run-admin-command.test.ts
test("create-organization needs --admin-email and prints the id first", ...);
test("create-organization says when it made an account", ...); // second line "new account for bram@example.test"
test("revoke-organization-admin refuses the last admin", ...); // exit code 1, one line on err
test("list marks an organization without an admin", ...);
// seed.test.ts: every organization has an admin after the seed, also when the organizations existed before without one; a second run changes nothing
// cast.test.ts: the cast has eight members; organizationAdminOtherOrganization administers otherOrganization only
// migrate.test.ts (add): the migration applies to a database that holds organizations; it fails when two names differ only in capitals
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Change every caller of `createOrganization` in the tests to pass a made-up `adminEmail`.
- [ ] **Step 4: Run.** `pnpm db:migrate && pnpm db:seed && pnpm check && pnpm test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Give every organization an admin from the start"`

---

### Task 3: An active working group always has a coordinator

**Files:**

- Create: `packages/db/src/managed-working-groups.ts`
- Modify: `packages/db/src/admin.ts`, `packages/db/src/members.ts`, `packages/db/src/audit-log.ts`, `packages/db/src/index.ts`, `packages/db/src/seed.ts`, `apps/api/src/cli/run-admin-command.ts`, `apps/api/src/testing/cast.ts`, `apps/api/src/routes/memberships.ts`, `packages/contracts/src/errors.ts`, `e2e/helpers/working-groups.ts`, and every test that calls `createWorkingGroup`
- Test: `packages/db/src/admin.test.ts`, `packages/db/src/members.test.ts`, `packages/db/src/managed-working-groups.test.ts`, `packages/db/src/seed.test.ts`, `apps/api/src/cli/run-admin-command.test.ts`, `apps/api/src/routes/members.test.ts`

**Interfaces:**

- Consumes: Task 1's `userHasLoggedIn`; Task 2's `normalizeName`, `emailAddressSchema`.
- Produces (from `@padvinder/db`), changed:
  - `lockWorkingGroup(tx: DbTransaction, workingGroupId: string): Promise<{ organizationId: string; active: boolean } | null>`: a row lock on the working group (`for no key update`), held until the transaction ends. Every function that removes a membership, clears the coordinator flag or changes `active` takes it before it reads the coordinators. A function that needs several takes them in the order of their IDs.
  - `createWorkingGroup(db: Db, input: { organizationId: string; name: string; city: string; coordinatorEmail: string }, actor: AuditActor): Promise<{ id: string; coordinatorUserId: string; coordinatorCreated: boolean }>`. One transaction: the group, the coordinator's account when there is none, the membership with the flag, the entries `working_group.created` and `role.coordinator_granted` (details `workingGroupId`), and `access-changed` for the coordinator. Throws `organization_not_found`, `name_taken`, `invalid_email`, `user_not_found`, `person_outside_organization`.
  - **Who may be the first coordinator,** when the actor is a user: the actor themself; an address without an account, or whose account never logged in (`last_login_at` empty); or someone who has a membership of any working group of this organization, or is an admin of it. Anyone else is `person_outside_organization`. The system (the tool, the seed, the cast) may name anyone.
  - `updateWorkingGroup(db: Db, input: { workingGroupId: string; patch: { name?: string; city?: string; active?: boolean } }, actor: AuditActor): Promise<{ changed: boolean }>`. Throws `working_group_not_found`, `name_taken`, and `no_coordinator` when it would switch on a group without a coordinator. A changed name or city writes one `working_group.updated` with, for each changed field only, the old and new value (`workingGroupNameFrom`, `workingGroupNameTo`, `cityFrom`, `cityTo`). A changed `active` writes its own entry, `working_group.deactivated` or `working_group.activated`, without details, and sends `access-changed` to every member of the group. A patch that changes nothing writes and sends nothing.
  - `setCoordinator(db: Db, input: { membershipId: string; isCoordinator: boolean }, actor: AuditActor): Promise<{ changed: boolean; userId: string; workingGroupId: string }>`. Works in an inactive group too. Throws `membership_not_found`, and `last_coordinator` when it would clear the flag of the last coordinator of an active group. Writes `role.coordinator_granted` or `role.coordinator_revoked` and sends `access-changed`, only when something changed.
  - `revokeCoordinator` (by address, the tool) throws `last_coordinator` by the same rule.
  - `removeMembership` gains the outcome `last_coordinator`: the member is the last coordinator of an active group, and nothing changes. `DELETE /api/memberships/{membershipId}` answers it with 409 `last_coordinator`.
  - New `AdminErrorCode`s: `membership_not_found`, `last_coordinator`, `no_coordinator`, `person_outside_organization`. New `AuditAction`s: `working_group.updated`, `working_group.deactivated`, `working_group.activated`. New API error codes: `lastCoordinator: "last_coordinator"`, `lastOrganizationAdmin: "last_organization_admin"`, `noCoordinator: "no_coordinator"`, `personOutsideOrganization: "person_outside_organization"`.
- Produces (from `@padvinder/db`, `managed-working-groups.ts`), with the type inferred from the contract of Task 7 once it exists:
  - `type ManagedWorkingGroup = { id: string; name: string; city: string; active: boolean; organization: { id: string; name: string }; memberCount: number; pendingRequestCount: number }`
  - `listManagedWorkingGroups(db: Db, access: Access): Promise<ManagedWorkingGroup[]>`: for a platform admin every group; otherwise every group, active or not, of the organizations in `adminOfOrganizationIds`, and the groups in `memberships` with the coordinator flag (`getAccess` leaves out inactive groups, so a coordinator sees only active ones). Each group once, sorted by organization name and then name in Dutch order. `memberCount` leaves out deleted accounts.
  - `getManagedWorkingGroup(db: Db, workingGroupId: string): Promise<ManagedWorkingGroup | null>`: one group, not scoped; the route authorizes.
  - `getMember(db: Db, membershipId: string): Promise<Member | null>`: one member with contact details and `hasLoggedIn`.
- The command-line tool: `create-working-group` requires `--coordinator-email <address>`, prints the ID first and `new account for <address>` on a second line when it made one. `revoke-coordinator` refuses the last coordinator of an active group. `list` marks an active working group without a coordinator with `[no coordinator]`.
- The seed: every working group has a coordinator, also one that existed before. Noord: `coordinator@example.test`. Zuid: `coordinator-zuid@example.test` ("Zoë Zuid"). Dorp: `coordinator-dorp@example.test`, without a name and without `last_login_at`, as the example of someone who never logged in.
- The test cast: `workingGroup` is made with `coordinator`, `foreignGroup` with `coordinatorOtherOrganization`, `otherGroup` with `cast-coordinator-other-group@example.test`, an account that never logs in and is not a cast member.
- `e2e/helpers/working-groups.ts`: `addWorkingGroup` passes `--coordinator-email` with a fresh address and returns it as `coordinatorAddress`. `makeVolunteer` keeps working: the group has its first coordinator already.

- [ ] **Step 1: Write the failing tests.**

```ts
// admin.test.ts
test("creating a working group makes its coordinator in the same transaction", ...);
// one membership with is_coordinator; entries working_group.created and role.coordinator_granted
test("a user may name themself, a new address, a never-used account, a member or admin of the organization", ...);
test("a user may not name someone with a profile outside the organization", async () => {
  // "buiten@example.test" logged in and is a member of a group of another organization
  await expect(createWorkingGroup(t.db, { ...input, coordinatorEmail: "buiten@example.test" }, { kind: "user", userId: admin }))
    .rejects.toMatchObject({ code: "person_outside_organization" });
  // no working group, no membership, no entry
});
test("the system may name anyone", ...);
test("two creates of the same name in one organization at the same moment give one group", ...);
test("the last coordinator of an active group keeps the role; with a second one it can go", ...);
// setCoordinator and revokeCoordinator: AdminError last_coordinator
test("two coordinators losing the role at the same moment leave one", ...);
test("the last coordinator of an inactive group can lose the role", ...);
test("someone can be made coordinator while the group is off", ...);
test("setting the flag to what it is changes nothing and writes no entry", ...);
test("switching off tells every member, writes working_group.deactivated, and takes the group out of getAccess", ...);
test("switching on needs a coordinator", ...); // AdminError no_coordinator; with one: every member is told again
test("a rename to the name of another group of the organization is name_taken; the same name in another organization is fine", ...);
test("a changed city writes cityFrom and cityTo and nothing else", ...);
// members.test.ts
test("removing the last coordinator of an active group is last_coordinator and changes nothing", ...);
test("a coordinator removed and another losing the role at the same moment leave one", ...);
// managed-working-groups.test.ts
test("a platform admin gets every group, an admin the groups of their organization also when off, a coordinator their active groups, a volunteer none", ...);
test("counts members without deleted accounts, and pending requests only", ...);
test("an admin who also coordinates a group gets it once", ...);
// routes/members.test.ts (add)
test("removing the last coordinator answers 409 last_coordinator", ...);
// run-admin-command.test.ts
test("create-working-group needs --coordinator-email", ...);
test("revoke-coordinator refuses the last coordinator of an active group", ...);
test("list marks an active working group without a coordinator", ...);
// seed.test.ts: every working group has a coordinator, also when the groups existed before without one
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Change every caller of `createWorkingGroup` in the tests to pass a made-up `coordinatorEmail`. A test that needs a group without a coordinator (part 1's fallback to the organization's admins) deletes the membership row directly.
- [ ] **Step 4: Run.** `pnpm db:seed && pnpm check && pnpm test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Give every working group a coordinator from the start"`

---

### Task 4: Deleting an account and the last one

**Files:**

- Create: `packages/contracts/src/account-deletion.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/db/src/accounts.ts`, `apps/api/src/routes/me.ts`, `packages/api-client/src/error-messages.ts`, `packages/ui/src/lib/messages.ts`, `packages/ui/src/index.ts`, `apps/mobile/src/screens/more/profile-screen.tsx`
- Create (generated): the OpenAPI file and client
- Test: `packages/db/src/accounts.test.ts`, `apps/api/src/routes/delete-me.test.ts`, `packages/api-client/src/error-messages.test.ts`, `packages/ui/src/lib/messages.test.ts`, `apps/mobile/src/screens/more/profile-screen.test.tsx`

**Interfaces:**

- Consumes: `lockOrganization`, `lockWorkingGroup`.
- Produces (contracts):
  - `accountDeletionBlockerSchema` (component `AccountDeletionBlocker`): `{ role: "coordinator" | "organizationAdmin"; workingGroupName: string | null; organizationName: string; contactEmail: string | null }`. `workingGroupName` is filled for `coordinator` only.
  - `accountDeletionBlockedSchema` (component `AccountDeletionBlocked`): `apiErrorSchema` extended with `blockers: AccountDeletionBlocker[]`, optional.
- Produces (from `@padvinder/db`): `DeleteAccountResult` gains `{ outcome: "blocked"; blockers: AccountDeletionBlocker[] }`: the user is the last coordinator of at least one active working group, or the last admin of at least one organization. Nothing changes. One blocker per group and per organization, groups first, each sorted by name in Dutch order.
- Lock order in `deleteAccount`: the platform admin lock, the user's request lock, the user's pending request rows (all as now), then the organizations the user administers and the working groups the user is a member of, each in the order of their IDs, then the user row. The memberships are read again after the locks.
- Produces (API): `DELETE /api/me` answers a blocked deletion with 409, code `last_coordinator` when the first blocker is a coordinator and `last_organization_admin` otherwise, with `blockers`. Its 409 schema is `accountDeletionBlockedSchema`; `last_platform_admin` keeps its body, without `blockers`.
- Produces (from `@padvinder/api-client`): `accountDeletionBlockers(error: unknown): AccountDeletionBlocker[]`, empty when the error carries none.
- Produces (from `@padvinder/ui`): `accountDeletionBlockedMessage(blocker: AccountDeletionBlocker): string`, the four texts in the table above. `apiErrorMessage` gains `last_organization_admin`, `last_coordinator` and `no_coordinator` (`person_outside_organization` needs the organization's name and gets its own function in Task 8).
- The mobile profile screen shows one sentence per blocker, in the confirm dialog, in place of the text for the code.

- [ ] **Step 1: Write the failing tests.**

```ts
// accounts.test.ts
test("the last coordinator of an active group cannot delete their account", async () => {
  expect(await deleteAccount(t.db, { userId, now })).toEqual({
    outcome: "blocked",
    blockers: [{ role: "coordinator", workingGroupName: "Noord", organizationName: "Paddentrek Voorbeeldstad", contactEmail: "contact-voorbeeldstad@example.test" }],
  });
  // the user keeps name, address, sessions and membership; no audit entry
});
test("with a second coordinator the deletion goes through", ...);
test("the last coordinator of an inactive group can delete their account", ...);
test("the last admin of an organization cannot; with a second admin it goes through", ...);
test("someone who is both gets one blocker for each, groups first", ...);
test("two coordinators of one group deleting their accounts at the same moment: one is deleted, one is blocked", ...);
test("a coordinator deleting their account while the other loses the role: one of the two is refused", ...);
// delete-me.test.ts
test("a blocked deletion answers 409 last_coordinator with the blockers, and the session stays", ...);
test("the last platform admin still gets 409 last_platform_admin without blockers", ...);
// messages.test.ts
test.each([/* the four rows of the table, with and without a contact address */])("%j gives %j", ...);
// profile-screen.test.tsx
test("a blocked deletion shows who to ask, in the dialog", ...);
// mock 409 with two blockers: both sentences are visible, and the profile stays
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Keep the last coordinator and admin from deleting their account"`

---

### Task 5: Permissions with the organization as a target

**Files:**

- Modify: `apps/api/src/permissions/rules.ts`
- Test: `apps/api/src/permissions/rules.test.ts`

**Interfaces:**

- Produces:
  - `type OrganizationTarget = { organizationId: string }`
  - `organizationRelationTo(actor: Actor, target: OrganizationTarget): "platformAdmin" | "organizationAdmin" | "outsider"`. A member or coordinator of one of the organization's working groups is an outsider to the organization.
  - `Permission` gains:

| Action                            | Target        | Platform admin | Admin of the organization | Coordinator of the group | Volunteer of the group | Everyone else |
| --------------------------------- | ------------- | -------------- | ------------------------- | ------------------------ | ---------------------- | ------------- |
| `platform.manageOrganizations`    | none          | allowed        | forbidden                 | forbidden                | forbidden              | forbidden     |
| `organization.view`               | organization  | allowed        | allowed                   | hidden                   | hidden                 | hidden        |
| `organization.changeContact`      | organization  | allowed        | allowed                   | hidden                   | hidden                 | hidden        |
| `organization.rename`             | organization  | allowed        | forbidden                 | hidden                   | hidden                 | hidden        |
| `organization.manageAdmins`       | organization  | allowed        | forbidden                 | hidden                   | hidden                 | hidden        |
| `organization.createWorkingGroup` | organization  | allowed        | allowed                   | hidden                   | hidden                 | hidden        |
| `workingGroup.manage`             | working group | allowed        | allowed                   | forbidden                | forbidden              | hidden        |
| `workingGroup.setCoordinator`     | working group | allowed        | allowed                   | forbidden                | forbidden              | hidden        |

- In this table `allowed`, `forbidden` and `hidden` are the three answers of `decide`, as part 1 built them. Both `forbidden` and `hidden` refuse; nobody gets in either way. They differ in what the refusal gives away. `hidden` answers 404, exactly as for a record that does not exist, because this person may not know that it exists: an organization they do not administer, a working group they are not in. `forbidden` answers 403, because this person can see the record already (their own working group, the organization they administer) and only this action is not theirs; a 404 there would tell the app that the record is gone. `platform.manageOrganizations` has no record to hide, so it is `forbidden` for everyone but a platform admin.
- `workingGroup.manage` covers a change of name, city or `active`. The `never` check in `decide` stays, so a permission without a rule does not compile.

- [ ] **Step 1: Write the failing tests:** one table test per row above, with an actor for each column, plus an admin of another organization and a coordinator of another group in the same organization (both hidden for the targeted actions).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add permissions for organizations and for managing working groups"`

---

### Task 6: Organization endpoints

**Files:**

- Create: `packages/contracts/src/organizations.ts`, `packages/contracts/src/fixtures/organizations.ts`, `apps/api/src/routes/organizations.ts`, `apps/api/src/admin-errors.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/fixtures/index.ts`, `apps/api/src/app.ts`, `packages/db/src/organizations.ts` (types from the contract)
- Create (generated): the OpenAPI file and client
- Test: `packages/contracts/src/organizations.test.ts`, `apps/api/src/routes/organizations.test.ts`, `apps/api/src/admin-errors.test.ts`

**Interfaces:**

- Consumes: Task 2's functions; Task 5's permissions; `apiError` with `issues`; the code `name_taken`.
- Produces (contracts):
  - `organizationSchema` (component `Organization`): `{ id: string; name: string; contactEmail: string | null }`
  - `organizationAdminSchema` (component `OrganizationAdmin`): `{ userId: string; name: string; email: string; hasLoggedIn: boolean }`
  - `organizationDetailSchema` (component `OrganizationDetail`): `Organization` with `admins: OrganizationAdmin[]`
  - `organizationListResponseSchema` (component `OrganizationListResponse`): `{ organizations: Organization[] }`
  - `organizationNameSchema`: a text, trimmed, 1 to 100 characters, without `@`.
  - `createOrganizationRequestSchema` (component `CreateOrganizationRequest`): strict `{ name; adminEmail: emailAddressSchema; contactEmail?: emailAddressSchema | null }`
  - `updateOrganizationRequestSchema` (component `UpdateOrganizationRequest`): strict, optional `name` and `contactEmail` (`null` empties it), at least one key.
  - `addOrganizationAdminRequestSchema` (component `AddOrganizationAdminRequest`): strict `{ email: emailAddressSchema }`
  - Fixtures: `organizationsFixture` (the two seeded organizations, one with and one without a contact address) and `organizationDetailFixture` (two admins, one who never logged in and has no name).
- Produces (API), every route with `preHandler: app.requireActor`:

| Endpoint                                                     | operationId               | Permission                                                                       | Answers                                                                            |
| ------------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/organizations`                                     | `listOrganizations`       | none: a scoped list, empty for who administers nothing                           | 200 `OrganizationListResponse`                                                     |
| `GET /api/organizations/{organizationId}`                    | `getOrganization`         | `organization.view`                                                              | 200 `OrganizationDetail`; 404                                                      |
| `POST /api/organizations`                                    | `createOrganization`      | `platform.manageOrganizations`                                                   | 201 `OrganizationDetail`; 400; 403; 409 `name_taken` with an issue on `name`       |
| `PATCH /api/organizations/{organizationId}`                  | `updateOrganization`      | `organization.changeContact`, and `organization.rename` when the body has `name` | 200 `OrganizationDetail`; 400; 403; 404; 409 `name_taken`                          |
| `POST /api/organizations/{organizationId}/admins`            | `addOrganizationAdmin`    | `organization.manageAdmins`                                                      | 200 `OrganizationDetail`, also when the person was an admin already; 400; 403; 404 |
| `DELETE /api/organizations/{organizationId}/admins/{userId}` | `removeOrganizationAdmin` | `organization.manageAdmins`                                                      | 204; 403; 404 when that user is no admin there; 409 `last_organization_admin`      |

- An organization that does not exist is the same 404 an outsider gets. The audit actor is `{ kind: "user", userId: request.actor.userId }`.
- Produces (`admin-errors.ts`): `adminErrorToApiError(error: AdminError, fields?: { email?: string }): ApiError`, used by these routes and Task 7's:

| `AdminError` code                                                                      | Answer                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `organization_not_found`, `working_group_not_found`, `membership_not_found`            | 404 `not_found`                                              |
| `invalid_email`, `user_not_found`                                                      | 400 `invalid_request`, with an issue on the email field      |
| `name_taken`                                                                           | 409 `name_taken`, with an issue on `name`                    |
| `person_outside_organization`                                                          | 409 with that code, with an issue on the email field         |
| `last_organization_admin`, `last_coordinator`, `last_platform_admin`, `no_coordinator` | 409 with that code                                           |
| `working_group_inactive`                                                               | Not reachable from a route: rethrow it, so a test sees a 500 |

- [ ] **Step 1: Write the failing tests.**

```ts
// routes/organizations.test.ts
const everyone = { platformAdmin: 200, organizationAdmin: 200, coordinator: 200, volunteer: 200, volunteerOtherGroup: 200, coordinatorOtherOrganization: 200, organizationAdminOtherOrganization: 200, applicant: 200, anonymous: 401 };
const adminsOfIt = (ok: number, admin = ok) => ({ platformAdmin: ok, organizationAdmin: admin, coordinator: 404, volunteer: 404, volunteerOtherGroup: 404, coordinatorOtherOrganization: 404, organizationAdminOtherOrganization: 404, applicant: 404, anonymous: 401 });
const platformOnly = (ok: number) => ({ platformAdmin: ok, organizationAdmin: 403, coordinator: 403, volunteer: 403, volunteerOtherGroup: 403, coordinatorOtherOrganization: 403, organizationAdminOtherOrganization: 403, applicant: 403, anonymous: 401 });
test("everyone logged in gets their own list", async () => await expectStatuses(cast, everyone, (headers) => ctx.app.inject({ url: "/api/organizations", headers })));
test("the list holds all for a platform admin, one for an admin, none for a coordinator", ...);
test("only its admins and platform admins see an organization", async () =>
  await expectStatuses(cast, adminsOfIt(200), (headers) => ctx.app.inject({ url: `/api/organizations/${cast.organization.id}`, headers })));
test("only a platform admin creates an organization", ...); // platformOnly(201), a new name per call
test("its admin changes the contact address", ...); // adminsOfIt(200)
test("only a platform admin renames it", ...); // adminsOfIt(200, 403) with a body that has name
test("a body with name and contactEmail from its admin changes nothing", ...); // 403, and the contact address stays
test("only a platform admin appoints an admin", ...); // adminsOfIt(200, 403)
test("only a platform admin removes an admin", ...); // adminsOfIt(204, 403), a fresh second admin per call
test("creating makes the first admin, also for an address without an account", ...);
test("a taken name in other capitals is 409 name_taken on name, and no second organization", ...);
test.each([{ name: "X", adminEmail: "jan@" }, { name: " ", adminEmail: "jan@example.test" }, { name: "X" }, { name: "X", adminEmail: "jan@example.test", extra: 1 }])("create rejects %j with 400", ...);
test("the address of a deleted account is 400 with an issue on adminEmail", ...);
test("removing the last admin is 409 last_organization_admin", ...);
test("removing someone who is no admin there is 404", ...);
test("appointing the same admin twice answers 200 twice and writes one entry", ...);
test("the audit entries name the platform admin as actor", ...);
test("contactEmail null empties it; an empty PATCH body and an unknown key are 400", ...);
test("an unknown organization is 404; an id that is not a UUID is 400", ...);
test("a POST from a foreign Origin is refused", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the organization endpoints"`

---

### Task 7: Working group and coordinator endpoints

**Files:**

- Create: `packages/contracts/src/managed-working-groups.ts`, `packages/contracts/src/fixtures/managed-working-groups.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/fixtures/index.ts`, `apps/api/src/routes/working-groups.ts`, `apps/api/src/routes/organizations.ts`, `apps/api/src/routes/memberships.ts`, `packages/db/src/managed-working-groups.ts` (type from the contract)
- Create (generated): the OpenAPI file and client
- Test: `packages/contracts/src/managed-working-groups.test.ts`, `apps/api/src/routes/managed-working-groups.test.ts`, `apps/api/src/routes/members.test.ts`

**Interfaces:**

- Consumes: Task 3's functions; Task 5's permissions; Task 6's `adminErrorToApiError`.
- Produces (contracts):
  - `managedWorkingGroupSchema` (component `ManagedWorkingGroup`): `{ id; name; city; active: boolean; organization: { id; name }; memberCount: number; pendingRequestCount: number }`
  - `managedWorkingGroupListResponseSchema` (component `ManagedWorkingGroupListResponse`): `{ workingGroups: ManagedWorkingGroup[] }`
  - `workingGroupNameSchema` and `citySchema`: a text, trimmed, 1 to 100 characters, without `@`.
  - `createWorkingGroupRequestSchema` (component `CreateWorkingGroupRequest`): strict `{ name; city; coordinatorEmail: emailAddressSchema }`
  - `updateWorkingGroupRequestSchema` (component `UpdateWorkingGroupRequest`): strict, optional `name`, `city`, `active`, at least one key.
  - `updateMembershipRequestSchema` (component `UpdateMembershipRequest`): strict `{ isCoordinator: boolean }`
  - Fixture `managedWorkingGroupsFixture`: Noord (12 members, 2 open requests), Zuid-Oost (3 members, none), and Buitengebied of the other organization, switched off.
- Produces (API), every route with `preHandler: app.requireActor`:

| Endpoint                                                  | operationId                | Permission                        | Answers                                                                                                                  |
| --------------------------------------------------------- | -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/managed-working-groups`                         | `listManagedWorkingGroups` | none: a scoped list               | 200 `ManagedWorkingGroupListResponse`                                                                                    |
| `POST /api/organizations/{organizationId}/working-groups` | `createWorkingGroup`       | `organization.createWorkingGroup` | 201 `ManagedWorkingGroup`; 400; 404; 409 `name_taken` on `name`; 409 `person_outside_organization` on `coordinatorEmail` |
| `PATCH /api/working-groups/{workingGroupId}`              | `updateWorkingGroup`       | `workingGroup.manage`             | 200 `ManagedWorkingGroup`; 400; 403; 404; 409 `name_taken`; 409 `no_coordinator`                                         |
| `PATCH /api/memberships/{membershipId}`                   | `updateMembership`         | `workingGroup.setCoordinator`     | 200 `Member` with contact details; 400; 403; 404; 409 `last_coordinator`                                                 |

- `GET /api/working-groups` (the list everyone chooses from) does not change: no field is added to it.
- The members and the membership requests of an inactive group stay reachable for its organization's admins and platform admins (`getWorkingGroup` does not filter on `active`); pin it with a test.

- [ ] **Step 1: Write the failing tests.**

```ts
// routes/managed-working-groups.test.ts
const managersOfGroup = (ok: number) => ({ platformAdmin: ok, organizationAdmin: ok, coordinator: 403, volunteer: 403, volunteerOtherGroup: 404, coordinatorOtherOrganization: 404, organizationAdminOtherOrganization: 404, applicant: 404, anonymous: 401 });
test("everyone logged in gets their own list", ...); // 200 for all, 401 anonymous
test("the list: all three groups for the platform admin, two for the organization's admin, one for the coordinator, none for a volunteer", ...);
test("only the organization's admins and platform admins create a working group", ...);
// adminsOfIt(201) from Task 6's test, a new name per call, coordinatorEmail the caller's own address where they have one
test("only they change a working group", async () =>
  await expectStatuses(cast, managersOfGroup(200), (headers) =>
    ctx.app.inject({ method: "PATCH", url: `/api/working-groups/${cast.workingGroup.workingGroupId}`, headers, payload: { city: "Enschede" } })));
test("only they make a member coordinator", ...); // managersOfGroup(200) on the volunteer's membership
test("creating makes the first coordinator; the answer counts one member", ...);
test("naming someone with a profile outside the organization is 409 on coordinatorEmail, and the answer holds no name or phone number", ...);
test("the creator may name themself", ...);
test("a taken name is 409 name_taken on name", ...);
test("switching off takes the group out of a member's /api/me, and switching on brings it back", ...);
test("a member's event stream gets access-changed when the group is switched off", ...);
test("switching on a group without a coordinator is 409 no_coordinator", ...);
test("clearing the flag of the last coordinator is 409 last_coordinator; with a second coordinator it is 200", ...);
test("the same PATCH twice answers 200 twice and writes one entry", ...);
test("the audit entry of a role change names the admin as actor and the working group in its details", ...);
test("an admin still lists the members of a group that is off, and makes one coordinator", ...);
test("an unknown working group or membership is 404; an empty body and an unknown key are 400", ...);
test("the list everyone chooses from still holds exactly id, name, city and organization", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the endpoints for managing working groups and coordinators"`

---

### Task 8: `packages/api-client`: administration queries and mutations

**Files:**

- Create: `packages/api-client/src/administration.ts`
- Modify: `packages/api-client/src/index.ts`, `packages/api-client/src/access-live-updates.ts`, `packages/ui/src/lib/messages.ts`, `packages/ui/src/index.ts`
- Test: `packages/api-client/src/administration.test.tsx`, `packages/api-client/src/access-live-updates.test.tsx`, `packages/ui/src/lib/messages.test.ts`

**Interfaces:**

- Consumes: the generated functions and query keys of Tasks 6 and 7; `apiErrorCode`; `apiErrorIssues`; `relationToWorkingGroup`, `refetchMembers`, `refetchMe`.
- Produces (from `@padvinder/api-client`):
  - `useManagedWorkingGroups()`, `useOrganizations()`, `useOrganization(organizationId: string)`: the queries. A 404 of `useOrganization` is data for the page (`null`), not an error that retries.
  - `refetchAdministration(queryClient: QueryClient): void`: invalidates the managed working groups, the organizations, every organization detail and every member list.
  - `useCreateOrganization()`, `useUpdateOrganization()`, `useAddOrganizationAdmin()`, `useRemoveOrganizationAdmin()`, `useCreateWorkingGroup()`, `useUpdateWorkingGroup()`, `useSetCoordinator()`: mutations that throw the API's error body and, when they settle (also after an error, which usually means the page was out of date), call `refetchAdministration` and `refetchMe`.
  - `mayManageWorkingGroup(me: MeResponse, group: { id: string; organization: { id: string } }): boolean`: a platform admin or an admin of the group's organization. For showing buttons only; the API decides.
  - `administersOrganization(me: MeResponse, organizationId: string): boolean`: a platform admin or an admin of it.
  - `useAccessLiveUpdates` also calls `refetchAdministration` on `access-changed`, on `membership-requests-changed` and on every (re)open.
- Produces (from `@padvinder/ui`):
  - `personOutsideOrganizationMessage(organizationName: string): string`: the text in the table at the top.
  - `organizationNameTakenMessage` and `workingGroupNameTakenMessage`: the two texts in that table.

- [ ] **Step 1: Write the failing tests** (`mockFetch`, the fixtures of Tasks 6 and 7).

```ts
test("useManagedWorkingGroups and useOrganizations load their lists", ...);
test("useOrganization gives null for a 404", ...);
test("creating a working group refetches the lists and me", ...);
test("a 409 surfaces with its code and the field", ...); // person_outside_organization, issues [{ path: "coordinatorEmail" }]
test("a failed mutation refetches too", ...);
test("mayManageWorkingGroup: a platform admin and the organization's admin, not a coordinator", ...);
test("access-changed refetches the administration lists", ...);
test("the three texts", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add administration queries to the API client"`

---

### Task 9: `packages/ui`: names of people, the row menu and the forms

**Files:**

- Create: shadcn `dropdown-menu` and `select` under `packages/ui/src/components/ui/`; `packages/ui/src/components/row-menu.tsx`; `packages/ui/src/components/administration/organization-form.tsx`, `working-group-form.tsx`, `person-email-form.tsx`; a `.stories.tsx` next to each form and the menu
- Modify: `packages/ui/src/lib/display-name.ts`, `packages/ui/src/components/members/member-list.tsx`, `packages/ui/src/components/members/member-detail.tsx`, their stories, `packages/ui/src/index.ts`, `packages/ui/package.json`
- Create (generated): reference images for the new and changed stories
- Test: next to each file

**Interfaces:**

- Consumes: `isEmailAddress` (Task 2); `Modal` in the stories only.
- Produces (from `@padvinder/ui`):
  - `displayName(name: string, hasLoggedIn?: boolean): string`: `(nog niet ingelogd)` when `hasLoggedIn` is `false`; otherwise `(nog geen naam)` for an empty name; otherwise the name. It replaces "Naam niet ingevuld" everywhere, also in the mobile app's member screens, which pass `member.hasLoggedIn`. `nameInSentence` stays.
  - `RowMenu(props: { label: string; items: { label: string; onSelect(): void; destructive?: boolean }[] })`: a button with three dots and the accessible name `label`, that opens the items as a menu. With no items it renders nothing.
  - `type OrganizationFormValues = { name: string; contactEmail: string | null; adminEmail: string }`
  - `OrganizationForm(props: { mode: "create" | "edit"; canRename: boolean; initial?: { name: string; contactEmail: string | null }; onSubmit(values: OrganizationFormValues): void; pending: boolean; fieldErrors?: { name?: string; contactEmail?: string; adminEmail?: string }; error?: string })`. In edit mode there is no admin field and `adminEmail` is `""`; with `canRename` false the name shows as text.
  - `type WorkingGroupFormValues = { organizationId: string; name: string; city: string; coordinatorEmail: string }`
  - `WorkingGroupForm(props: { mode: "create" | "edit"; organizations: { id: string; name: string }[]; ownEmail: string; initial?: { name: string; city: string }; onSubmit(values: WorkingGroupFormValues): void; pending: boolean; fieldErrors?: { name?: string; city?: string; coordinatorEmail?: string }; error?: string })`. The organization is a select only in create mode with more than one organization; with one it is that one. In edit mode there is no coordinator field.
  - `PersonEmailForm(props: { hint?: string; submitLabel: string; onSubmit(email: string): void; pending: boolean; fieldError?: string; error?: string })`: one field `E-mailadres`.
- Exact copy:
  - Organization form: fields `Naam`, `Contactadres` with below it `Het adres waar leden terechtkunnen als er iets niet klopt. Mag leeg blijven.`, and `E-mailadres van de beheerder` with below it `Heeft deze persoon nog geen account? Dan wordt het aangemaakt.`
  - Working group form: `Organisatie`, `Naam`, `Plaats`, and `E-mailadres van de coördinator`, which starts with `ownEmail`, with below it `Deze persoon wordt de eerste coördinator. Je kunt je eigen adres laten staan.`
  - Buttons `Bewaar`; while pending `Even geduld…`, disabled.
  - An empty name: `Vul een naam in.` An empty city: `Vul een plaats in.` Over 100 characters: `Een naam mag hoogstens honderd tekens hebben.` or `Een plaats mag hoogstens honderd tekens hebben.` An address that `isEmailAddress` refuses (an empty contact address is fine): `Vul een geldig e-mailadres in.` Each under its field, and no call of `onSubmit`.
  - `fieldErrors` show under their field; `error` above the button. Values are trimmed before `onSubmit`; an empty contact address becomes `null`.
- Stories: each form in Create, Edit, Pending, WithFieldError; the working group form also WithSeveralOrganizations; the organization form also EditWithoutRename; the menu Open; the member list and detail with the fourth fixture member.

- [ ] **Step 1: Write the failing tests.**

```tsx
test.each([["Noor", true, "Noor"], ["", true, "(nog geen naam)"], ["", false, "(nog niet ingelogd)"], ["Noor", false, "(nog niet ingelogd)"], ["", undefined, "(nog geen naam)"]])(
  "displayName(%j, %j) is %j", ...);
test("the menu opens its items and calls onSelect; without items there is no button", ...);
test("the working group form starts with the own address and submits the trimmed values", ...);
test("with one organization there is no select and its id is submitted", ...);
test("an empty name, an empty city, a name with an @ and the address 'jan@' each show their text and do not submit", ...);
test("the organization form turns an empty contact address into null", ...);
test("edit mode without canRename shows the name as text and submits it unchanged", ...);
test("a field error from the server shows under its field", ...);
test("markup in a name is shown as text", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Add the shadcn components** (follow AGENTS.md's shadcn notes after each `shadcn add`), then implement.
- [ ] **Step 4: Run.** `pnpm check && pnpm screenshots:update && pnpm test:visual:docker`. Expected: PASS, with new and changed reference images to commit.
- [ ] **Step 5: Commit.** `git commit -m "Add the administration forms and the row menu"`

---

### Task 10: `packages/ui`: the tables

**Files:**

- Create: `packages/ui/src/components/administration/working-group-table.tsx`, `members-table.tsx`, `organization-table.tsx`, `organization-admins-table.tsx`, a `.stories.tsx` next to each
- Modify: `packages/ui/src/index.ts`
- Create (generated): reference images
- Test: next to each file

**Interfaces:**

- Consumes: the `Table` parts; `RowMenu`, `displayName` (Task 9); the contract types and fixtures of Tasks 1, 6 and 7.
- Produces (from `@padvinder/ui`):
  - `WorkingGroupTable(props: { workingGroups: ManagedWorkingGroup[]; onOpen(id: string): void })`
  - `MembersTable(props: { members: Member[]; canSetCoordinator: boolean; canRemove(member: Member): boolean; onSetCoordinator(member: Member, isCoordinator: boolean): void; onRemove(member: Member): void })`
  - `OrganizationTable(props: { organizations: Organization[]; onOpen(id: string): void })`
  - `OrganizationAdminsTable(props: { admins: OrganizationAdmin[]; canRemove: boolean; onRemove(admin: OrganizationAdmin): void })`
- Exact copy:
  - Working groups: columns `Naam`, `Plaats`, `Organisatie`, `Leden`, `Aanmeldingen`, `Actief`. The column `Organisatie` is left out when every row has the same organization. The name is a button that calls `onOpen`. `Actief` shows `ja` or `nee`; a group that is off has muted text in its whole row. No rows: `Er zijn nog geen werkgroepen.` The table keeps the order it is given.
  - Members: columns `Naam`, `E-mailadres`, `Telefoonnummer`, and a last column without a heading. The name comes from `displayName(member.name, member.hasLoggedIn)`; a coordinator's name is bold with `Coördinator` below it. The email address and a plain phone number are links, as `ContactRows` makes them; no phone number leaves the cell empty. The menu is named `Acties voor {naam}` and holds `Maak coördinator` or, for a coordinator, `Niet langer coördinator` (with `canSetCoordinator`), and `Verwijder uit werkgroep` (when `canRemove(member)`). No rows: `Deze werkgroep heeft nog geen leden.`
  - Organizations: columns `Naam`, `Contactadres`; no contact address leaves the cell empty. No rows: `Er zijn nog geen organisaties.`
  - Organization admins: columns `Naam`, `E-mailadres`, and with `canRemove` a menu `Acties voor {naam}` with `Verwijder als beheerder`.
- Stories: working groups (Default with `managedWorkingGroupsFixture`, OneOrganization, Empty); members (AsAdmin, AsCoordinator, Empty); organizations (Default, Empty); admins (AsPlatformAdmin, AsOrganizationAdmin).

- [ ] **Step 1: Write the failing tests.**

```tsx
test("the organization column shows only when the rows have more than one organization", ...);
test("a group that is off shows nee", ...);
test("a coordinator's row shows Coördinator and offers Niet langer coördinator", ...);
test("a volunteer's row offers Maak coördinator, which calls onSetCoordinator(member, true)", ...);
test("without canSetCoordinator and with canRemove false for coordinators, a coordinator's row has no menu", ...);
test("a member who never logged in shows (nog niet ingelogd) and the menu is named for that text", ...);
test("the admins table has no menu without canRemove", ...);
test("markup in a name is shown as text", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm screenshots:update && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the administration tables"`

---

### Task 11: Portal: working groups

**Files:**

- Create: `apps/portal/src/pages/working-groups-page.tsx`, `apps/portal/src/pages/working-group-page.tsx`, `apps/portal/src/pages/create-working-group.tsx` (the modal with the form, used by this task and the next)
- Modify: `apps/portal/src/layout/navigation.ts`, `apps/portal/src/router.tsx`, `apps/portal/src/pages/home-page.tsx`
- Test: `apps/portal/src/layout/navigation.test.ts`, `apps/portal/src/pages/working-groups-page.test.tsx`, `apps/portal/src/pages/working-group-page.test.tsx`, `apps/portal/src/pages/home-page.test.tsx`, `apps/portal/src/router.test.ts`

**Interfaces:**

- Consumes: Tasks 8, 9 and 10; `navigationFor`, `managesSomething`, `PortalLayout`, `NotFoundPage`, `Modal`, `showToast`; `ConfirmDialog`; `useRemoveMembership`, `mayRemoveMember`, `listMembersOptions`.
- Produces:
  - `navigationFor(me)` gains, in the order of the spec's navigation table: `{ label: "Werkgroepen", to: "/working-groups" }` first, for everyone for whom `managesSomething(me)` holds; then, for a platform admin or an admin of more than one organization, `{ label: "Organisaties", to: "/organizations" }`, and for an admin of exactly one who is no platform admin `{ label: "Organisatie", to: "/organizations/{id}" }`; then the items of the previous plan.
  - Home's text "Hier is nog niets te doen. Het beheer komt binnenkort." goes: everyone who manages something has an item now.
  - `/working-groups`: heading `Werkgroepen`, `WorkingGroupTable` with `useManagedWorkingGroups()`, and for who administers at least one organization (or is platform admin) a button `Nieuwe werkgroep`. Someone for whom `managesSomething(me)` does not hold sees `NotFoundPage`.
  - `CreateWorkingGroup(props: { open: boolean; organizations: { id: string; name: string }[]; onClose(): void })`: `WorkingGroupForm` in a `Modal` titled `Nieuwe werkgroep`. A platform admin's organizations come from `useOrganizations()`, an admin's from `me.organizationAdminOf`. On success the modal closes, the toast says `Werkgroep {naam} is toegevoegd.` and the browser goes to the new group's page. A 409 keeps the modal open: `name_taken` puts `workingGroupNameTakenMessage` under `Naam`, `person_outside_organization` puts `personOutsideOrganizationMessage(organisatie)` under the email field. A 400 with an issue on `coordinatorEmail` puts `Vul een geldig e-mailadres in.` there. Any other failure shows `apiErrorMessage(code)` above the button.
  - `/working-groups/{workingGroupId}`: the group is found in `useManagedWorkingGroups()`; when the list is loaded and the group is not in it, `NotFoundPage`. Heading: the name, with below it `{plaats} · {organisatie}`, and for a group that is off `Deze werkgroep staat uit.` Then the heading `Leden` and `MembersTable` with the group's members.
    - For who `mayManageWorkingGroup`: `Wijzig` opens `WorkingGroupForm` in edit mode in a `Modal` titled `Werkgroep wijzigen`; the toast is `Werkgroep {naam} is gewijzigd.` `Zet uit` asks with `ConfirmDialog`: title `Werkgroep {naam} uitzetten?`, text `De leden zien deze werkgroep dan niet meer in de app.`, confirm `Zet uit`; the toast is `Werkgroep {naam} staat uit.` `Zet aan` does not ask; its toast is `Werkgroep {naam} staat aan.`
    - `canSetCoordinator` is `mayManageWorkingGroup`; `canRemove` is `mayRemoveMember` (a coordinator removes volunteers only). `Maak coördinator` and `Niet langer coördinator` do not ask; their toasts are `{naam} is nu coördinator van {werkgroep}.` and `{naam} is geen coördinator meer van {werkgroep}.` `Verwijder uit werkgroep` asks as the app does: title `{naam} verwijderen uit {werkgroep}?`, text `{naam} kan zich daarna opnieuw aanmelden.`, confirm `Verwijder`; the toast is `{naam} is verwijderd uit {werkgroep}.` `{naam}` in these texts is `nameInSentence(member.name)`.
    - A failed action that has a dialog shows `apiErrorMessage(code)` inside the dialog; one without a dialog shows it as a toast.
  - Loading: `Werkgroepen laden…` and `Leden laden…`. A failed load: the connection text with `Probeer opnieuw`.

- [ ] **Step 1: Write the failing tests** (`renderPortal` from `apps/portal/src/testing/render-portal.tsx`, as the species page's tests).

```tsx
test("navigationFor", () => {
  expect(navigationFor(coordinatorMeFixture).map((i) => i.to)).toEqual(["/working-groups"]);
  expect(navigationFor(twoOrganizationsMeFixture).map((i) => [i.label, i.to])).toEqual([["Werkgroepen", "/working-groups"], ["Organisatie", "/organizations/0192f3c0-0000-7000-8000-0000000000a2"]]);
  expect(navigationFor(platformAdminMeFixture).map((i) => i.to)).toEqual(["/working-groups", "/organizations", "/species", "/system"]);
  expect(navigationFor(meFixture)).toEqual([]);
});
test("home sends a coordinator to /working-groups", ...);
test("a coordinator sees their groups and no Nieuwe werkgroep", ...);
test("an admin adds a working group and lands on its page with the toast", ...);
test("a taken name and a person outside the organization each show their text under the field, and the modal stays", ...);
test("a volunteer who opens /working-groups or a group's page sees the not-found page", ...);
test("a coordinator sees the members, no Wijzig, and a menu on volunteers only", ...);
test("an admin makes a member coordinator and takes it away again, each with its toast", ...);
test("taking it from the last coordinator shows the text for last_coordinator as a toast", ...);
test("Zet uit asks first; confirming sends active false", ...);
test("Zet aan on a group without a coordinator shows the text for no_coordinator", ...);
test("removing a member asks first and shows the toast", ...);
test("when the group leaves the list while its page is open, the page turns into not found", ...);
// send an access-changed event while the next answer of the list no longer holds the group
test("no portal route starts with /app or /api", ...); // the existing test still passes
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and look.** `pnpm check && pnpm build`. Then `pnpm dev`, log in on the portal as `beheerder@example.test`, add a working group, make someone coordinator, switch the group off and on. Save a screenshot of a working group's page to `.context/working-group-page.png`.
- [ ] **Step 5: Commit.** `git commit -m "Add the working group pages to the portal"`

---

### Task 12: Portal: organizations

**Files:**

- Create: `apps/portal/src/pages/organizations-page.tsx`, `apps/portal/src/pages/organization-page.tsx`
- Modify: `apps/portal/src/router.tsx`
- Test: `apps/portal/src/pages/organizations-page.test.tsx`, `apps/portal/src/pages/organization-page.test.tsx`

**Interfaces:**

- Consumes: Tasks 8, 9, 10 and 11 (`CreateWorkingGroup`).
- Produces:
  - `/organizations`: for a platform admin or an admin of more than one organization: heading `Organisaties` and `OrganizationTable` with `useOrganizations()`; for a platform admin also the button `Nieuwe organisatie`. An admin of exactly one organization who is no platform admin is sent on to its page. Anyone else sees `NotFoundPage`.
  - `Nieuwe organisatie` opens `OrganizationForm` in a `Modal` with that title. On success the toast says `Organisatie {naam} is toegevoegd.` and the browser goes to its page. `name_taken` puts `organizationNameTakenMessage` under `Naam`; a 400 with an issue on `adminEmail` or `contactEmail` puts `Vul een geldig e-mailadres in.` under that field.
  - `/organizations/{organizationId}`: `useOrganization(id)`; `null` (the API's 404) renders `NotFoundPage`. Heading: the name, with below it `Contactadres: {adres}` or `Geen contactadres`. `Wijzig` opens `OrganizationForm` in edit mode (`canRename` for a platform admin) in a `Modal` titled `Organisatie wijzigen`; the toast is `Organisatie {naam} is gewijzigd.` Only changed fields are sent.
  - Section `Beheerders`: `OrganizationAdminsTable`, with `canRemove` for a platform admin. For a platform admin the button `Voeg beheerder toe` opens `PersonEmailForm` in a `Modal` titled `Beheerder toevoegen`, with the hint `Heeft deze persoon nog geen account? Dan wordt het aangemaakt.` and the button `Voeg toe`; the toast is `{adres} is beheerder van {organisatie}.` `Verwijder als beheerder` asks: title `{naam} verwijderen als beheerder van {organisatie}?`, text `{naam} kan {organisatie} dan niet meer beheren.`, confirm `Verwijder`; the toast is `{naam} is geen beheerder meer van {organisatie}.`
  - Section `Werkgroepen`: the organization's groups from `useManagedWorkingGroups()`, each as its name and city, linked to its page; none: `Deze organisatie heeft nog geen werkgroepen.` The button `Nieuwe werkgroep` opens `CreateWorkingGroup` for this organization.
  - Loading: `Organisaties laden…` and `Organisatie laden…`. A failed load: the connection text with `Probeer opnieuw`.

- [ ] **Step 1: Write the failing tests.**

```tsx
test("a platform admin sees the table and adds an organization", ...); // the modal closes, the toast shows, the page of the new organization opens
test("a taken name shows its text under Naam and the modal stays", ...);
test("an admin of one organization who opens /organizations lands on its page", ...);
test("a coordinator who opens /organizations or an organization's page sees the not-found page", ...);
test("an admin changes the contact address and cannot change the name", ...); // the PATCH body holds contactEmail only
test("a platform admin renames it", ...);
test("an admin sees the admins without a menu and without Voeg beheerder toe", ...);
test("a platform admin adds an admin by address and removes one after confirming", ...);
test("removing the last admin shows the text for last_organization_admin in the dialog", ...);
test("the section Werkgroepen lists this organization's groups only", ...);
test("when the organization answers 404 while its page is open, the page turns into not found", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and look.** `pnpm check && pnpm build`. Then `pnpm dev`, log in on the portal as `hoofdbeheerder@example.test`, add an organization, add a second admin, remove the first. Save a screenshot of an organization's page to `.context/organization-page.png`.
- [ ] **Step 5: Commit.** `git commit -m "Add the organization pages to the portal"`

---

### Task 13: Mails from staging say so

**Files:**

- Modify: `apps/api/src/env.ts`, `apps/api/src/mail/mailer.ts`, `apps/api/src/start-api.ts` (only if the mailer is not made from the whole env there), `.env.example`, `infra/alwaysdata/src/environments.ts`, `infra/alwaysdata/src/env-file.ts`, `infra/alwaysdata/README.md`
- Test: `apps/api/src/env.test.ts`, `apps/api/src/mail/mailer.test.ts`, `infra/alwaysdata/src/env-file.test.ts`

**Interfaces:**

- The spec: part 1's design, "The mails", "Mails from staging are marked" (asked by the maintainer on 25 November 2026).
- Produces:
  - The API's env gains `MAIL_SUBJECT_PREFIX`, optional: a text of at most 30 characters, without a line break. Empty counts as absent.
  - `createSmtpMailer` puts the prefix and one space before the subject of every mail it sends, when the setting is there. The mail builders, the memory mailer and `Mail.subject` do not change, so no test of a mail text changes.
  - `Environment` in `infra/alwaysdata/src/environments.ts` gains `mailSubjectPrefix?: string`: `"[STAGING]"` for staging, absent for production. `renderEnvFile` writes the line `MAIL_SUBJECT_PREFIX=[STAGING]` only for an environment that has one.
- Local development sets nothing, so the end-to-end helpers that read a subject keep working.
- The README: the setting in the table under "Mail"; and under "Operating notes" what the maintainer does once after this pull request is merged: run Provision for `staging` with `apply` on (it rewrites the env file with the new line), then restart staging's services or wait for the next deploy. Until then staging's mails have no prefix; nothing breaks.

- [ ] **Step 1: Write the failing tests.**

```ts
// mailer.test.ts (against the SMTP transport the existing tests use)
test("with MAIL_SUBJECT_PREFIX the subject starts with it and a space", ...); // "[STAGING] 123456 is je inlogcode voor PadVinder"
test("without it the subject is unchanged", ...);
// env.test.ts
test("MAIL_SUBJECT_PREFIX is optional, and an empty one counts as absent", ...);
test("a prefix with a line break is refused", ...);
// env-file.test.ts
test("staging's env file holds MAIL_SUBJECT_PREFIX=[STAGING]; production's has no such line", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm test:fake-host`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Mark the subject of mails from staging"`

---

### Task 14: End-to-end tests and documentation

**Files:**

- Create: `e2e/portal-administration.spec.ts`
- Modify: `e2e/delete-account.spec.ts`, `AGENTS.md`, `infra/alwaysdata/README.md` (only the part on the administration tool), `scripts/lib/ci-jobs.ts` and its test (only if needed)

**Interfaces:**

- Consumes: `newAddress`, `createSession`, `runAdmin`, `createWorkingGroup`, `makeVolunteer`; the Playwright project `portal` (every `portal-*.spec.ts`, laptop-sized, on the portal's origin).
- A test in the `portal` project that also needs the app opens a second browser context with the phone's settings and the app's origin (`MOBILE_PORT`).
- Organizations and working groups cannot be deleted, so every run leaves its own behind, named with random letters as the helpers do.

- [ ] **Step 1: Write the tests.**

```ts
test("a platform admin makes an organization, and its admin makes a working group", async ({
  browser,
}) => {
  // The platform admin (runAdmin grant-platform-admin) adds an organization with a fresh admin address:
  // the toast "Organisatie … is toegevoegd." shows and the admin's address is in the table Beheerders, as "(nog niet ingelogd)".
  // In a second context the admin logs in on the portal: the navigation holds Werkgroepen and Organisatie.
  // They add a working group and leave their own address as coordinator: they land on its page and are in Leden as Coördinator.
});
test("an admin makes a member coordinator, and the last coordinator cannot go", async ({
  page,
  context,
}) => {
  // A group from createWorkingGroup with a volunteer from makeVolunteer; the session is the organization's admin.
  // Maak coördinator on the volunteer: the toast shows. Niet langer coördinator on the first coordinator: works.
  // Niet langer coördinator on the remaining one: "Een werkgroep heeft altijd een coördinator. …" shows and the row keeps Coördinator.
});
test("a working group that is switched off leaves its member's app, and comes back", async ({
  browser,
}) => {
  // A volunteer has the app open on Meer, in a second, phone-sized context. The admin switches the group off in the portal:
  // the volunteer's app shows "Kies je werkgroep" without a reload. Switched on again: the tabs are back.
});
// delete-account.spec.ts (add; it runs in the phone-sized project)
test("the only coordinator cannot delete their account in the app", async ({ page, context }) => {
  // Profiel, Verwijder account, confirm: "Je bent de enige coördinator van …" shows and the profile stays.
});
```

- [ ] **Step 2: Run.** `pnpm test:e2e` three times. Expected: PASS each time.
- [ ] **Step 3: Update `AGENTS.md`.**
  - Current state: the portal manages organizations, working groups, admins and coordinators; what is left of this part. Correct the sentence that production is not yet provisioned: it was provisioned on 23 November 2026 and is deployed (on 25 November 2026 it answered `/api/health` with the commit of pull request 20). Correct the same in the opening of "Verification" in `infra/alwaysdata/README.md`.
  - Glossary: `contactEmail` ("contactadres": the address of an organization that people are told to write to).
  - Roles and permissions: the organization as a target (`organizationRelationTo`), and that a member of a working group is an outsider to its organization; an organization always has an admin and an active working group a coordinator; who may be a first coordinator; `lockOrganization` and `lockWorkingGroup`, who takes them and in which order, next to the lock for platform admins; `users.last_login_at` decides whether someone ever logged in, never the name or `email_verified`.
  - The audit log: the new actions, and the keys for names of things.
  - API: `emailAddressSchema` as the one rule for a typed address; `adminErrorToApiError`; the new error codes; the blockers on `DELETE /api/me`.
  - Permission tests: the cast has eight people; name the new one.
  - Administration tool: the new required options, the second output line, the refusals, the marks in `list`.
  - Seed data: the admins, coordinators and the contact address.
  - Tests: `createWorkingGroup()` in the end-to-end helpers returns the admin's and coordinator's addresses.
- [ ] **Step 4: Update `infra/alwaysdata/README.md`,** "Administration tool": the new options, and one paragraph for the maintainer: before this pull request is deployed to an environment, give every organization there an admin and every active working group a coordinator with the grant commands (a grant changes nothing where the person has the role already); after the deploy, `list` marks what is still missing. Nothing breaks while one is missing, but its requests reach nobody. In "Verification", "Login and mail": the maintainer confirmed on 25 November 2026 that a code mail from staging arrives and that Gmail's "Show original" says `PASS` for SPF, DKIM and DMARC; set the first and the third row to confirmed with that date, and the second row to confirmed for Gmail with the other providers still open. In "DNS": MX, SPF and DMARC records exist (25 November 2026); tick them and add them to the table.
- [ ] **Step 5: Check the CI rules** (AGENTS.md, "CI"), then run everything: `pnpm check && pnpm build && pnpm test:e2e && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Add end-to-end tests for portal administration and document it"`

## Deviations

Recorded while building, 25 November 2026. One line each: what, and why.

- Task 1: `userHasLoggedIn` lives in `packages/db/src/users.ts`, not `members.ts`, so every query that returns `hasLoggedIn` can share it.
- Tasks 1–3: the generated migration folders are renamed from Drizzle's random names (`…_last_login_at`, `…_organization_contact_and_unique_name`, `…_working_group_unique_name`), so the migration tests find them by name.
- Task 2: the replaced address of a deleted account is `user_not_found` in the administration functions, as the plan names it; `DELETED_ACCOUNT_EMAIL_DOMAIN` is exported from `@padvinder/contracts` so the email schema and `deletedAccountEmail` share it. On the routes Zod refuses such an address first (400 on the field).
- Task 2: `updateOrganization` also throws `invalid_email` for a contact address that is not valid; the plan lists only `organization_not_found` and `name_taken`.
- Tasks 2–3: the tool's `listOrganizations` gains `hasAdmin` and, per working group, `hasCoordinator`, which the `[no admin]` and `[no coordinator]` marks need.
- Task 2: the seed fills in the Voorbeeldstad contact address only when it is empty, so a locally changed one stays; the cast logs everyone in before it creates the organizations.
- Task 3: working group names are unique within an organization ignoring capitals (unique index `working_groups_name_key` on `(organization_id, lower(name))`, replacing the case-sensitive constraint). The plan added no migration for it, but Review Focus 2 asks for "the same name in another shape" to be 409 for working groups too. Like the organizations migration, it fails on a database where two groups of one organization differ only in capitals.
- Task 3: `getMember` lives in `members.ts` next to `listMembers`, whose contact select it shares; `countCoordinators` is exported for `deleteAccount`; the cast exports `OTHER_GROUP_COORDINATOR_EMAIL`.
- Task 3: the tool's `grant-coordinator` still refuses an inactive group; `setCoordinator` (the portal, by membership) works there as the plan asks. The seed leaves a locally switched-off group alone for that reason.
- Task 3: a rename sends no `access-changed`, as the plan says; an open app shows the old name until it next loads `/api/me`. Left for later.
- Task 4: `findOrCreateUser` locks an existing user row `for key share`. The task review found that a role given by address at the moment the account is deleted could otherwise land on the deleted account (the foreign key check does not stop it). Now such a grant waits and answers `user_not_found`.
- Task 4: `deleteAccount`'s second read, after the user row lock, also locks an organization or working group that appeared since the first read, so a role given in between is counted under its lock. `countOrganizationAdmins` is exported next to `countCoordinators`.
- Task 4: several blockers show as one paragraph in the app's confirm dialog (the sentences joined by a space in the one error text), so `ConfirmDialog` and its images did not change. `accountDeletionBlockedMessage` falls back to "je werkgroep" if a coordinator blocker ever arrives without a group name.
- Task 7: `mapAdminErrors` moved to `apps/api/src/admin-errors.ts`, shared by the organization, working group and membership routes.
- Task 9: the shadcn `dropdown-menu` and `select` are written by hand in shadcn's style with inline SVG icons (no `lucide-react`, as in the previous pull request); a shared `administration/field.tsx` holds the text field, its hint and the name checks; `RowMenu` has an optional `defaultOpen` only for its Open story. With one organization the working group form shows its name as text under "Organisatie".
- Task 10: the four tables share one test file, `administration-tables.test.tsx`; the admins table has no empty text, because an organization always has an admin.
- Task 11: extra files `apps/portal/src/layout/require-manages-something.tsx` (the not-found guard), `apps/portal/src/pages/load-error.tsx` (the connection text with "Probeer opnieuw") and `apps/portal/src/testing/requests.ts` (shared request helpers, now also used by the species tests); `invalidEmailMessage` is exported from `@padvinder/ui`; one extra text, "Werkgroep laden…", while a group's page waits for the list.
- Task 11: `/` now sends a platform admin to `/working-groups` (the first navigation item), so `e2e/portal-species.spec.ts` goes to Soorten from there.
- Tasks 11–12: a portal list (organizations, working groups, members) keeps what it showed when a background refetch fails; only a list that never loaded shows the connection text. Found in Task 12's review.
- Task 12: `twoOrganizationsMeFixture` administers one organization, so the "admin of two organizations" test builds its own me; the removal dialog and toast use `nameInSentence`, so an admin who never logged in reads "Deze persoon".
- Task 14: the README's paragraph for the maintainer says a group without a coordinator still has its request mails sent to the organization's admins (part 1's fallback), and reach nobody only without an admin, instead of "its requests reach nobody"; it also says how the migrations fail on names that differ only in capitals and what to do then.
- Task 14: AGENTS.md gets a subsection "Organizations and working groups" (endpoints, unique names, on and off, the contact address), and names one exception to "`last_login_at` decides": the last-platform-admin rule still reads `email_verified`.
- Task 14: DKIM is left unticked in the README's DNS list; the maintainer confirmed MX, SPF and DMARC.
- Final review: the backfill of `last_login_at` also fills it for an account without a session that has `email_verified` (from `users.updated_at`), and leaves deleted accounts empty. Better Auth deletes the session at logging out, so the backfill from sessions alone, as Task 1 asked, would have counted everyone who had logged out as never logged in, on production too: shown as "(nog niet ingelogd)", open to being named first coordinator from another organization, and at risk from the next plan's rule on removing a person who never logged in. The migration had not shipped, so it was changed in place; the spec's data model row says the same now. A local dev database that ran the first version keeps its values.
- Final review: the administration mutations wait for their refetch of the lists and me before they finish, so the page of a new working group does not show "niet gevonden" for a moment; other callers of `refetchMe` and `refetchMembers` keep their timing.
- Final review: an empty name or city (only spaces, through the tool) is refused with the new `AdminError` code `invalid_name` (400 with an issue on the field in the API); each organization action has its own case in `decide`, so a new one cannot be allowed by default; the tests of two changes at the same moment hold a lock and wait until the other side is blocked, so they fail every time without the lock; corrected comments on the lock order around `deleteAccount` (an audit entry's foreign key to its actor can make a rare deadlock, which PostgreSQL breaks with a 500 on one side and nothing lost).
- Orchestration session (25 November 2026): AGENTS.md does not say "never `email_verified`". `last_login_at` decides whether someone ever logged in for member lists, `hasLoggedIn` and who may be a first coordinator; the rule on the last platform admin (`hasOtherPlatformAdmin`) still reads `email_verified`, which a first login sets, and is unchanged.
