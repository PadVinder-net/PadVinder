# The Audit Log Page, Platform Admins and Deleting an Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pull request 4 of "Portal administration": an organization admin and a platform admin read the audit log in the portal, a platform admin appoints and removes platform admins, and a platform admin deletes an account for someone who asks.

**Architecture:** One scoped query in `packages/db` reads a page of audit entries by a cursor on (`occurred_at`, `id`) and fills in, with a fixed number of queries per page, the people, working groups and species the page mentions; who is named follows the rule on who sees names. The API answers structured entries without any Dutch; `packages/ui` turns each into one Dutch sentence, from a table that is complete for every known action by its type. Platform admins and account deletion reuse the administration functions and `deleteAccount`, with a second way in by user ID. The portal gets three pages on the existing layout.

**Tech Stack:** The existing stack. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-22-portal-administration-design.md` (read it, the design of part 1 `2026-11-21-accounts-and-access-design.md`, and `AGENTS.md` before starting any task). This plan covers item 4 under "Order of work": "The audit log" ("Reading it"), the page "Hoofdbeheerders", "Deleting an account for someone", their endpoints, their three navigation items and their tests.

**Builds on:** the pull request of `2026-11-25-organizations-working-groups-and-roles.md` (pull request 2), merged or as a branch to stack on. Names marked _(from the organizations plan)_ or _(from the adding people plan)_ come from a plan, not from code: check the real name before you use it, read the "Deviations" at the end of that plan, and keep the behavior asked here. This plan does not need `2026-11-25-adding-people.md` (3a) or `2026-11-25-requests-in-the-portal.md` (3b), and they do not need this one. Whichever is built later rebases on the earlier ones and resolves the shared files: `apps/portal/src/layout/navigation.ts`, `apps/portal/src/router.tsx`, `packages/ui/src/lib/messages.ts`, `packages/ui/src/index.ts`, `packages/api-client/src/administration.ts`, `packages/db/src/accounts.ts`, `packages/db/src/audit-log.ts`, `packages/contracts/src/errors.ts` and `AGENTS.md`. The generated OpenAPI file, client and migrations are made again with `pnpm api:generate` and `pnpm db:generate`, never merged by hand.

**The seam with pull request 3a:** that plan gives `deleteAccount` the input `deletedBy?: AuditActor` and adds the actions `membership.added` and `membership.invited`. This plan needs the first and knows the second (Task 2 and Task 5 say what to do when 3a is not there yet).

**A deviation from the spec's API table:** the lookup is `POST /api/users/lookup` with the address in the body, not `GET /users?email=…`. The address of a request ends up in Fastify's request log (`LOG_LEVEL=info`) and in Alwaysdata's `admin/logs/http/`, and the spec's anti-goals forbid personal data in server logs. The spec leaves paths to the builder; the behavior is the spec's.

**What the deploy needs:** nothing. One migration adds an index.

## Global Constraints

- AGENTS.md applies in full: English code, Dutch UI copy with "je", English kebab-case URL paths, glossary terms, naming per location, generated files never edited by hand.
- Run `pnpm check` before every commit (it includes `check:generated`). After any change to a route or contract run `pnpm api:generate`; after any schema change run `pnpm db:generate`. Commit the generated files.
- Every new or changed story needs its reference image: run `pnpm screenshots:update` (Docker; never on the host) and commit the images. A story of a table asks for a wide viewport with `visualViewport` (1024×768).
- Routes reach the user only through `request.actor` and decide only through `authorize` or `decide`. Every endpoint behind a permission has one `expectStatuses` test with the standard cast (eight people _(from the organizations plan)_).
- Answers: 401 without a login; 404 for what the actor may not see at all; 403 for what they may see but not change; 409 for a conflict. Error bodies follow `apiErrorSchema`; the portal chooses the Dutch text from `code` and never shows `message`.
- This plan only reads the audit log. It adds no action, and no endpoint changes or removes an entry. The changes it makes (platform admins, a deleted account) write the entries part 1 defined, in the transaction of the change.
- An answer of the audit log holds no email address, no phone number, no user ID, and no name the actor may not see. Tests check the raw JSON.
- An email address never goes in the path or the query of a request: it goes in the body, and no log line holds it.
- The lookup matches one whole address, compared as equal after trimming and lowering capitals. Never `like`, never a part of an address.
- The portal pages follow the species page: a dialog cannot be closed while its save runs; a failed action shows its text inside its dialog, or as a toast when it has none; a page someone may not see renders the not-found page and follows a change of rights without a reload; tests use `renderPortal`.
- "soort" is the glossary's word for a species, so the filter on kind of action is labeled `Actie`, never "Soort actie".
- The API stays backward compatible: only add fields to existing responses.
- Fixtures, seed data and test addresses are made up and end in `@example.test`.
- Dutch copy in this plan is exact. Where a small text is missing, write it in the same style.
- Commit after every task with a message in English, ending with the co-author line your session's instructions give. Do not push after every commit.

Dutch texts used in more than one task:

| Code or situation                                     | Text                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A person who is no longer connected                   | `Voormalig lid`                                                                         |
| A deleted account                                     | `Verwijderd account`                                                                    |
| A platform admin who is not connected                 | `Hoofdbeheerder`                                                                        |
| The command-line tool                                 | `Systeem`                                                                               |
| No account for the address                            | `Geen account met dit adres.`                                                           |
| `own_account`                                         | `Dit is je eigen account. Dat verwijder je in de app, onder Meer > Profiel.`            |
| `last_platform_admin`, on the page "Hoofdbeheerders"  | `Er moet een hoofdbeheerder blijven die al eens is ingelogd.`                           |
| Someone else's account, only coordinator of a group   | `{naam} is de enige coördinator van {werkgroep}. Maak eerst iemand anders coördinator.` |
| Someone else's account, only admin of an organization | `{naam} is de enige beheerder van {organisatie}. Maak eerst iemand anders beheerder.`   |
| The question before deleting                          | `Account van {naam} verwijderen?` with the text `Dit kun je niet terugdraaien.`         |

The sentence per audit action, built in Task 7. `{persoon}` is the entry's person as the table above and `displayName` show them; `{werkgroep}`, `{organisatie}` and `{soort}` are the current names the entry carries. A missing one reads `iemand`, `een werkgroep`, `een organisatie` or `een soort`. Where a row lists parts, the parts that apply are joined with `, `.

| Action                            | Sentence                                                                                                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organization.created`            | `Organisatie toegevoegd: {organisatie}`                                                                                                                                                                                                                                            |
| `organization.updated`            | `Organisatie gewijzigd: ` and the parts `{organizationNameFrom} wordt {organizationNameTo}` (without a changed name: `{organisatie}`), `contactadres gewijzigd`                                                                                                                    |
| `working_group.created`           | `Werkgroep toegevoegd: {werkgroep}`                                                                                                                                                                                                                                                |
| `working_group.updated`           | `Werkgroep gewijzigd: ` and the parts `{workingGroupNameFrom} wordt {workingGroupNameTo}` (without a changed name: `{werkgroep}`), `plaats {cityFrom} wordt {cityTo}`                                                                                                              |
| `working_group.deactivated`       | `Werkgroep uitgezet: {werkgroep}`                                                                                                                                                                                                                                                  |
| `working_group.activated`         | `Werkgroep aangezet: {werkgroep}`                                                                                                                                                                                                                                                  |
| `role.platform_admin_granted`     | `Hoofdbeheerder gemaakt: {persoon}`                                                                                                                                                                                                                                                |
| `role.platform_admin_revoked`     | `Niet langer hoofdbeheerder: {persoon}`                                                                                                                                                                                                                                            |
| `role.organization_admin_granted` | `Beheerder gemaakt: {persoon} bij {organisatie}`                                                                                                                                                                                                                                   |
| `role.organization_admin_revoked` | `Niet langer beheerder: {persoon} bij {organisatie}`                                                                                                                                                                                                                               |
| `role.coordinator_granted`        | `Coördinator gemaakt: {persoon} bij {werkgroep}`                                                                                                                                                                                                                                   |
| `role.coordinator_revoked`        | `Niet langer coördinator: {persoon} bij {werkgroep}`                                                                                                                                                                                                                               |
| `membership_request.approved`     | `Aanmelding goedgekeurd: {persoon} bij {werkgroep}`                                                                                                                                                                                                                                |
| `membership_request.rejected`     | `Aanmelding afgewezen: {persoon} bij {werkgroep}`                                                                                                                                                                                                                                  |
| `membership.added`                | `Lid toegevoegd: {persoon} bij {werkgroep}`                                                                                                                                                                                                                                        |
| `membership.invited`              | `Uitgenodigd om zich aan te melden: {persoon} bij {werkgroep}`                                                                                                                                                                                                                     |
| `membership.removed`              | `Lid verwijderd: {persoon} uit {werkgroep}`                                                                                                                                                                                                                                        |
| `account.deleted`                 | `Account verwijderd`                                                                                                                                                                                                                                                               |
| `species.created`                 | `Soort toegevoegd: {soort}`                                                                                                                                                                                                                                                        |
| `species.updated`                 | `Soort gewijzigd: ` and the parts `{dutchNameFrom} wordt {dutchNameTo}` (without a changed Dutch name: `{soort}`), `wetenschappelijke naam {scientificNameFrom} wordt {scientificNameTo}`, and by `needsVerificationTo` `betrouwbaarheidscheck aan` or `betrouwbaarheidscheck uit` |
| `species.deactivated`             | `Soort uitgezet: {soort}`                                                                                                                                                                                                                                                          |
| `species.activated`               | `Soort aangezet: {soort}`                                                                                                                                                                                                                                                          |
| Any other action                  | The action's own text, as stored (`safety_test.published`)                                                                                                                                                                                                                         |

## Review Focus

1. **The log grows while someone reads it.** Entries are written between two presses on "Laad meer"; one transaction writes two entries with the same moment; two entries lie microseconds apart, closer than a JavaScript date can tell. Every entry shows exactly once, newest first, and none is skipped. Pinned in Task 2 and Task 9.
2. **An organization admin reads about people who are not theirs.** A member who was removed, someone who deleted their account, the platform admin who made the organization, the tool, and an admin who also runs another organization. The raw answer holds none of their names, also not when the admin asks for another organization by filter or borrows a platform admin's cursor. Pinned in Task 2 and Task 3.
3. **A new platform admin by a mistyped address.** Whoever owns the address can log in and see everything. The page shows the address once more before it appoints; capitals and spaces reach the same account; the same address twice changes nothing; the new row reads "(nog niet ingelogd)" and does not count as the other platform admin, so the appointer cannot remove themself yet, and the page says why. Pinned in Task 4 and Task 10.
4. **The wrong account, or one that holds a group together.** A part of an address, `%@example.test`, the old address of a deleted account, the address in capitals, the platform admin's own address, the only coordinator of a group, a second press on the button. Only the whole address finds an account; the question names whose account it is; the only coordinator stays, with a sentence that says what to do first; a second delete is a 404, not an error page; and the address is in no log line. Pinned in Task 5 and Task 10.
5. **An entry the page was not written for.** An open portal meets an action a newer API writes; `working_group.updated` holds only a city; a species changed only its check; a name holds markup. The row shows the action's own text or the shorter sentence, never an error, an empty cell, `undefined` or rendered markup. Pinned in Task 7.

---

### Task 1: Permissions for the log, platform admins and accounts

**Files:**

- Modify: `apps/api/src/permissions/rules.ts`
- Test: `apps/api/src/permissions/rules.test.ts`

**Interfaces:**

- Consumes: `OrganizationTarget`, `organizationRelationTo` _(from the organizations plan)_.
- Produces: `Permission` gains:

| Action                          | Target       | Platform admin | Admin of the organization | Everyone else |
| ------------------------------- | ------------ | -------------- | ------------------------- | ------------- |
| `organization.readAuditLog`     | organization | allowed        | allowed                   | hidden        |
| `platform.managePlatformAdmins` | none         | allowed        | forbidden                 | forbidden     |
| `platform.deleteAccounts`       | none         | allowed        | forbidden                 | forbidden     |

- `platform.deleteAccounts` covers the lookup and the deletion. The two platform actions have no record to hide, so they are `forbidden`, as `platform.manageSpecies` is. A member or coordinator of one of the organization's working groups is an outsider to its log.

- [ ] **Step 1: Write the failing tests:** one table test per row, with an actor for each column, plus an admin of another organization and a coordinator of a group of this organization (both hidden for `organization.readAuditLog`).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add permissions for the audit log, platform admins and account deletion"`

---

### Task 2: Reading the audit log

**Files:**

- Create: `packages/contracts/src/audit-log.ts`, `packages/contracts/src/fixtures/audit-log.ts`, `packages/db/src/audit-log-entries.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/fixtures/index.ts`, `packages/db/src/audit-log.ts`, `packages/db/src/schema/audit-log.ts`, `packages/db/src/index.ts`
- Create (generated): one migration for the index
- Test: `packages/contracts/src/audit-log.test.ts`, `packages/db/src/audit-log-entries.test.ts`, `packages/db/src/migrate.test.ts`

**Interfaces:**

- Consumes: `userHasLoggedIn` _(from the organizations plan)_; `Access`.
- Produces (contracts):
  - `auditActions`: the list of every action, as a constant: the 22 in the sentence table above. `type AuditAction` is inferred from it, and `packages/db/src/audit-log.ts` takes its `AuditAction` from here in place of its own union. `membership.added` and `membership.invited` _(from the adding people plan)_ and the actions of the organizations plan are in the list whether or not their pull request is merged; a plan that is merged later finds them there.
  - `auditActionGroups = ["organization", "workingGroup", "role", "membership", "account", "species"]`, `type AuditActionGroup`, and `auditActionPrefixes: Record<AuditActionGroup, readonly string[]>`: `organization.`; `working_group.`; `role.`; `membership.` and `membership_request.`; `account.`; `species.`. A group matches by prefix, so a later action falls into its group without a change here.
  - `AUDIT_LOG_PAGE_SIZE = 50`.
  - `auditLogCursorSchema`: the text `{occurredAt}_{id}`, where `occurredAt` is UTC with six decimals (`2026-11-25T19:04:05.123456Z`) and `id` a UUID. Plain text, so it can be read and sent with `curl`. A text of another shape, or whose moment is not a real one, is refused.
  - `auditLogPersonSchema` (component `AuditLogPerson`): `{ kind: "named" | "former_member" | "deleted_account" | "platform_admin" | "system"; name?: string; hasLoggedIn?: boolean }`. `name` and `hasLoggedIn` are present exactly for `named`.
  - `auditLogEntrySchema` (component `AuditLogEntry`): `{ id: string; occurredAt: string; action: string; actor: AuditLogPerson; person: AuditLogPerson | null; organization: { id: string; name: string } | null; workingGroup: { id: string; name: string } | null; species: { id: string; dutchName: string } | null; details: Record<string, string | number | boolean | null> }`. `action` is a text, not an enum: an open portal may meet an action it does not know.
  - `auditLogPageSchema` (component `AuditLogPage`): `{ entries: AuditLogEntry[]; nextCursor: string | null }`.
  - `listAuditLogEntriesQuerySchema`: strict, all optional: `organizationId` (a UUID), `actionGroup`, `cursor`.
  - Fixture `auditLogFixture: AuditLogEntry[]`, newest first: one entry for every action in `auditActions`, with a person of each kind among them; `organization.updated` with only `contactChanged`; `working_group.updated` with only a city; `species.updated` with only the check; and one entry with the action `safety_test.published`.
- Produces (schema): the index `audit_log_entries_occurred_at_id_idx` on (`occurred_at`, `id`).
- Produces (from `@padvinder/db`, `audit-log-entries.ts`):
  - `listAuditLogEntries(db: Db, access: Pick<Access, "isPlatformAdmin" | "adminOfOrganizationIds">, input: { organizationId?: string; actionGroup?: AuditActionGroup; cursor?: string; limit?: number }): Promise<AuditLogPage>`. `limit` is `AUDIT_LOG_PAGE_SIZE` by default; tests pass a small one.
  - **Scope.** A platform admin: every entry. Anyone else: the entries whose `organization_id` is in `adminOfOrganizationIds`, so never an entry without an organization, and nothing for who administers none. The filters narrow the scope and never widen it: an `organizationId` outside the scope gives an empty page.
  - **Order and paging.** `occurred_at` descending, then `id` descending. With a cursor: the entries for which (`occurred_at`, `id`) is smaller than the cursor's pair, compared as a row in SQL. The query reads one entry more than the limit to know whether there is a next page; `nextCursor` is made from the last entry of the page, `null` on the last page. The cursor's moment is formatted by PostgreSQL with all six decimals and read back as `timestamptz`, never through a JavaScript `Date`, which would cut the microseconds and skip entries.
  - **What an entry is about.** `person`: the subject when its type is `user`; the applicant when it is `membership_request`; otherwise `null`. `workingGroup`: the subject when its type is `working_group`, otherwise `details.workingGroupId`; `null` for a non-platform admin when that group is not of the entry's organization. `species`: the subject of type `species`. `organization`: the entry's organization. Names are the current ones.
  - **Who is named,** for the actor and the person alike, in this order: an entry of the tool is `system`; a deleted account is `deleted_account`, for everyone; for a platform admin every other person is `named`; for anyone else a person is `named` when they are connected to the entry's organization now, by a membership of any of its working groups (also one that is switched off), a pending request for one, or an admin row; a platform admin who is not connected is `platform_admin`; everyone else is `former_member`.
  - **A fixed number of queries per page:** the entries (with their organization and the applicant of a request), then one query each for the people, the working groups and the species the page mentions. Never one per entry.

- [ ] **Step 1: Write the failing tests** (its own test database; entries are written with `recordAudit`, and with plain inserts where a test sets `occurred_at`).

```ts
// contracts/audit-log.test.ts
test("every action falls in exactly one group", ...);
test.each(["2026-11-25T19:04:05.123Z_0192f3c0-0000-7000-8000-000000000001", "2026-13-45T19:04:05.123456Z_0192f3c0-0000-7000-8000-000000000001", "x", ""])("the cursor %j is refused", ...);
test("the fixture parses and holds every action of auditActions", ...);
// db/audit-log-entries.test.ts
test("newest first, 50 at a time, and no cursor after the last page", ...); // 120 entries: 50, 50, 20, null
test("entries of one moment and entries microseconds apart each appear exactly once", async () => {
  // three entries at 12:00:00.123456, one at .123457 and one at .123999, read with limit 2:
  // the pages together hold the five ids once each, in (occurred_at, id) descending order
});
test("an entry written between two pages does not shift the next page", ...);
test("the group membership holds membership.* and membership_request.*, and no role.*", ...);
test("an organization admin gets the entries of their organization and none without one", ...);
test("an organizationId outside the scope gives an empty page", ...);
test("a coordinator and a volunteer get an empty page", ...);
test("a platform admin gets every entry and every current name", ...);
test("an organization admin gets the name of a member, of someone with a pending request and of an admin of the entry's organization", ...);
test("a member of a working group that is switched off is still named", ...);
test("a removed member is former_member, as the actor and as the person", ...);
test("someone connected only to another organization the actor administers is former_member in this organization's entry", ...);
test("a deleted account is deleted_account, also for a platform admin", ...);
test("the tool is system; a platform admin who is not connected is platform_admin for an organization admin", ...);
test("the person of a decided request is its applicant; the working group comes from the subject or from details", ...);
test("a named person who never logged in has hasLoggedIn false and an empty name", ...);
test("a page of 50 takes as many queries as a page of 5", ...); // a spy on t.pool.query
// migrate.test.ts (add): the migration applies to a database that holds audit entries
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm db:generate`.
- [ ] **Step 4: Run.** `pnpm db:migrate && pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Read the audit log by page, with names by the rule on who sees them"`

---

### Task 3: The audit log endpoint

**Files:**

- Create: `apps/api/src/routes/audit-log.ts`
- Modify: `apps/api/src/app.ts`
- Create (generated): the OpenAPI file and client
- Test: `apps/api/src/routes/audit-log.test.ts`

**Interfaces:**

- Consumes: Task 1's `organization.readAuditLog`; Task 2's `listAuditLogEntries`, `listAuditLogEntriesQuerySchema`, `auditLogPageSchema`.
- Produces (API): `GET /api/audit-log-entries` (operationId `listAuditLogEntries`), with `preHandler: app.requireActor`: 200 `AuditLogPage`; 400; 401; 404.
  - Without `organizationId`: no permission, a scoped list, as `GET /api/organizations` _(from the organizations plan)_: a platform admin gets everything, an organization admin the entries of the organizations they administer, anyone else an empty page.
  - With `organizationId`: `authorize(actor, { action: "organization.readAuditLog", target })`. Someone without an admin row for that organization gets 404, also a member of one of its working groups, and also for an ID no organization has: the log of an organization is a record they may not see at all, and an empty page would look like an organization without history. A platform admin gets an empty page for an ID no organization has; nothing is hidden from them.
  - An unknown query parameter is 400, so a mistyped filter never looks like "everything".
  - The route passes `request.actor` to `listAuditLogEntries` as the scope and does nothing else with the entries.

- [ ] **Step 1: Write the failing tests** (the cast; then, as cast members, an approved request, a removed member, a deleted account and a species, so the log holds entries of both organizations and without one).

```ts
const everyone = { platformAdmin: 200, organizationAdmin: 200, coordinator: 200, volunteer: 200, volunteerOtherGroup: 200, coordinatorOtherOrganization: 200, organizationAdminOtherOrganization: 200, applicant: 200, anonymous: 401 };
const adminsOfIt = { platformAdmin: 200, organizationAdmin: 200, coordinator: 404, volunteer: 404, volunteerOtherGroup: 404, coordinatorOtherOrganization: 404, organizationAdminOtherOrganization: 404, applicant: 404, anonymous: 401 };
test("everyone logged in gets their own page", async () => await expectStatuses(cast, everyone, (headers) => ctx.app.inject({ url: "/api/audit-log-entries", headers })));
test("only its admins and platform admins read the log of an organization", async () =>
  await expectStatuses(cast, adminsOfIt, (headers) => ctx.app.inject({ url: `/api/audit-log-entries?organizationId=${cast.organization.id}`, headers })));
test("the organization admin's page holds entries of their organization only, and none without one", ...);
// every entry's organization.id is cast.organization.id; no species.created, no role.platform_admin_granted
test("a coordinator's, a volunteer's and the applicant's page is empty", ...);
test("the platform admin's page holds entries of both organizations and those without one", ...);
test("the organization admin's raw answer holds no name they may not see", async () => {
  // not the removed member's name, not the platform admin's, not a name from the other organization;
  // no "@", and no key "email", "phone", "userId" or "actorUserId" anywhere in the body
});
test("the platform admin's raw answer holds no email address and no phone number", ...);
test("a cursor from the platform admin's page gives the organization admin only their own entries", ...);
test("actionGroup narrows the page; with organizationId both apply", ...);
test("an organizationId no organization has is 404 for an organization admin and an empty page for a platform admin", ...);
test.each(["?actionGroup=people", "?cursor=x", "?organisationId=0192f3c0-0000-7000-8000-000000000001", "?organizationId=x"])("%s is 400", ...);
test("reading writes no entry, and POST, PATCH and DELETE on the path are 404", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the endpoint that reads the audit log"`

---

### Task 4: Platform admins: list, appoint, remove

**Files:**

- Create: `packages/contracts/src/platform-admins.ts`, `packages/contracts/src/fixtures/platform-admins.ts`, `packages/db/src/platform-admins.ts`, `apps/api/src/routes/platform-admins.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/fixtures/index.ts`, `packages/db/src/admin.ts`, `packages/db/src/index.ts`, `apps/api/src/app.ts`
- Create (generated): the OpenAPI file and client
- Test: `packages/db/src/admin.test.ts`, `packages/db/src/platform-admins.test.ts`, `apps/api/src/routes/platform-admins.test.ts`

**Interfaces:**

- Consumes: Task 1's `platform.managePlatformAdmins`; `grantPlatformAdmin`, `revokePlatformAdmin`, `lockPlatformAdmins`, `hasOtherPlatformAdmin`; `emailAddressSchema`, `adminErrorToApiError`, `userHasLoggedIn` _(from the organizations plan)_.
- Produces (contracts):
  - `platformAdminSchema` (component `PlatformAdmin`): `{ userId: string; name: string; email: string; hasLoggedIn: boolean }`
  - `platformAdminListResponseSchema` (component `PlatformAdminListResponse`): `{ platformAdmins: PlatformAdmin[] }`
  - `addPlatformAdminRequestSchema` (component `AddPlatformAdminRequest`): strict `{ email: emailAddressSchema }`
  - Fixture `platformAdminsFixture`: three, one of them `meFixture`'s user, one who never logged in and has no name.
- Produces (from `@padvinder/db`):
  - `listPlatformAdmins(db: Db): Promise<PlatformAdmin[]>`: sorted by name in Dutch order, then by address.
  - `removePlatformAdmin(db: Db, input: { userId: string }, actor: AuditActor): Promise<{ changed: boolean }>`, the portal's way in by ID next to `revokePlatformAdmin` by address; both share one body. `changed: false` when that user is no platform admin. It takes `lockPlatformAdmins` and throws `last_platform_admin` by the existing rule: another platform admin who has logged in at least once must remain. Someone may remove themself when such a one remains.
  - The rule is not changed here: `hasOtherPlatformAdmin` keeps reading `email_verified`, which a first login sets, while the list's `hasLoggedIn` reads `last_login_at`. They differ only for an account whose sessions were all gone when the organizations plan's migration ran.
- Produces (API), every route with `preHandler: app.requireActor` and `platform.managePlatformAdmins`:

| Endpoint                               | operationId           | Answers                                                                           |
| -------------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `GET /api/platform-admins`             | `listPlatformAdmins`  | 200 `PlatformAdminListResponse`; 403                                              |
| `POST /api/platform-admins`            | `addPlatformAdmin`    | 200 `PlatformAdminListResponse`, also when the person was one already; 400; 403   |
| `DELETE /api/platform-admins/{userId}` | `removePlatformAdmin` | 204; 400; 403; 404 when that user is no platform admin; 409 `last_platform_admin` |

- The account is made when the address has none. The address of a deleted account is 400 with an issue on `email` (`adminErrorToApiError(error, { email: "email" })`). The audit actor is `{ kind: "user", userId: request.actor.userId }`. No mail is sent: whoever appoints someone tells them.

- [ ] **Step 1: Write the failing tests.**

```ts
// admin.test.ts
test("removePlatformAdmin removes the flag, writes role.platform_admin_revoked and tells the person", ...);
test("removing someone who is no platform admin changes nothing and writes no entry", ...);
test("the last platform admin who logged in cannot be removed, also not when another was appointed and never logged in", ...);
test("two platform admins removing each other at the same moment leave one", ...);
// platform-admins.test.ts
test("lists the platform admins by name, with hasLoggedIn", ...);
// routes/platform-admins.test.ts
const platformOnly = (ok: number) => ({ platformAdmin: ok, organizationAdmin: 403, coordinator: 403, volunteer: 403, volunteerOtherGroup: 403, coordinatorOtherOrganization: 403, organizationAdminOtherOrganization: 403, applicant: 403, anonymous: 401 });
test("only a platform admin lists them", ...); // platformOnly(200)
test("only a platform admin appoints one", ...); // platformOnly(200), a new address per call
test("only a platform admin removes one", ...); // platformOnly(204), a freshly appointed one per call
test("a refused appointment makes no account and no platform admin", ...);
test("appointing ' Nieuw@Example.TEST ' makes the account nieuw@example.test, shown as never logged in", ...);
test("appointing the same address twice answers 200 twice and writes one entry, with the platform admin as actor", ...);
test.each([{ email: "jan@" }, {}, { email: "jan@example.test", extra: 1 }])("appointing with %j is 400", ...);
test("the address of a deleted account is 400 with an issue on email", ...);
test("the only platform admin who logged in cannot remove themself: 409 last_platform_admin, and the flag stays", ...);
test("with a second platform admin who logged in, someone removes themself, and their next list is 403", ...);
test("removing a user who is no platform admin, or an unknown id, is 404; an id that is not a UUID is 400", ...);
test("a POST from a foreign Origin is refused", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the endpoints for platform admins"`

---

### Task 5: Looking up an account and deleting it for someone

**Files:**

- Create: `packages/contracts/src/accounts.ts`, `packages/contracts/src/fixtures/accounts.ts`, `apps/api/src/routes/users.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/fixtures/index.ts`, `packages/contracts/src/errors.ts`, `packages/db/src/accounts.ts`, `apps/api/src/app.ts`
- Create (generated): the OpenAPI file and client
- Test: `packages/db/src/accounts.test.ts`, `apps/api/src/routes/users.test.ts`

**Interfaces:**

- Consumes: Task 1's `platform.deleteAccounts`; `deleteAccount` with the outcome `blocked` and its `blockers`, `accountDeletionBlockedSchema`, `emailAddressSchema`, `userHasLoggedIn` _(from the organizations plan)_.
- Produces (contracts):
  - `accountSummarySchema` (component `AccountSummary`): `{ id: string; name: string; email: string; hasLoggedIn: boolean; isPlatformAdmin: boolean; organizationAdminOf: { id: string; name: string }[]; workingGroups: { id: string; name: string; organization: { id: string; name: string }; isCoordinator: boolean }[] }`
  - `findAccountRequestSchema` (component `FindAccountRequest`): strict `{ email: emailAddressSchema }`
  - New error code `ownAccount: "own_account"`.
  - Fixtures `accountSummaryFixture` (a coordinator of Noord who is also a volunteer of Zuid) and `accountWithoutGroupsFixture` (never logged in, no name, nothing else).
- Produces (from `@padvinder/db`):
  - `findAccountByEmail(db: Db, email: string): Promise<AccountSummary | null>`: the account whose address equals `email`, trimmed and in lower case; `null` when there is none or it was deleted. The working groups are all the person's memberships, also of groups that are switched off (the deletion removes those too), sorted by organization and then name in Dutch order.
  - `deleteAccount` takes `deletedBy?: AuditActor` in its input: the actor of the `account.deleted` entry, by default the user themself. When the adding people plan is merged it is there already: use it. When it is not, add exactly this to the input and nothing else of that plan (`onlyIfUnused` and the outcome `kept` stay with it).
- Produces (API), both routes with `preHandler: app.requireActor` and `platform.deleteAccounts`:

| Endpoint                     | operationId   | Answers                                                             |
| ---------------------------- | ------------- | ------------------------------------------------------------------- |
| `POST /api/users/lookup`     | `findAccount` | 200 `AccountSummary`; 400; 403; 404 when no account has the address |
| `DELETE /api/users/{userId}` | `deleteUser`  | 204; 400; 403; 404; 409                                             |

- The lookup changes nothing and writes no audit entry. Its 403 does not depend on the address, so nobody else learns whether an account exists. Its 404 and 400 messages do not repeat the address.
- `DELETE` calls `deleteAccount` with `deletedBy` the platform admin. Its outcomes: `deleted` is 204; `not_found` (unknown, or deleted already) is 404; `blocked` is 409 with the code of the first blocker (`last_coordinator` or `last_organization_admin`) and `blockers`, in the shape `accountDeletionBlockedSchema`, as `DELETE /api/me` answers it; `last_platform_admin` is 409 with that code. The actor's own ID is 409 `own_account` before anything is read: their own account goes through the app, which also ends the session properly.
- The deleted person's sessions end and their open apps show the login screen, through `deleteAccount`'s own `access-changed`.

- [ ] **Step 1: Write the failing tests.**

```ts
// accounts.test.ts
test("findAccountByEmail finds the whole address, in any capitals and with spaces around it", ...);
test.each(["noor", "noor@example", "%@example.test", "no_r@example.test", "noor@example.test%"])("%j finds nothing", ...);
// "no_r" would match "noor" under like
test("the old address of a deleted account finds nothing, and so does its replaced address", ...);
test("lists every membership, also of a group that is switched off, and the organizations the person administers", ...);
test("with deletedBy the entry account.deleted names that actor; without it the user", ...);
// routes/users.test.ts
test("only a platform admin looks up an account", ...); // platformOnly(200) with the volunteer's address
test("an address without an account is 404 for a platform admin and still 403 for everyone else", ...); // platformOnly(404)
test("only a platform admin deletes someone's account", ...); // platformOnly(204), a fresh account per call
test("the lookup answers id, name, address and working groups, and no phone number", ...); // the raw body has no key "phone"
test("an unknown address is 404; 'noor' and 'deleted-…@deleted.invalid' are 400; an empty body and an unknown key are 400", ...);
test("the request log of a lookup holds no address", async () => {
  // an app with logStream, logger on: a 200, a 404 and a 400 lookup; no log line contains "@"
});
test("deleting wipes the name, address and phone, ends the sessions and removes the memberships", ...);
test("the entry account.deleted names the platform admin as actor and holds no details", ...);
test("an applicant and an account that never logged in can be deleted", ...);
test("the last coordinator of an active group is 409 last_coordinator with the blockers, and nothing changes", ...);
test("the last admin of an organization is 409 last_organization_admin with the blockers", ...);
test("with a second coordinator the deletion goes through", ...);
test("a platform admin's own id is 409 own_account, and the account stays", ...);
test("a second delete of the same id is 404; an unknown id is 404; an id that is not a UUID is 400", ...);
test("after the deletion the same address is 404 in the lookup, and logs in as a new account", ...);
test("a POST from a foreign Origin is refused", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Look up an account by address and delete it for someone"`

---

### Task 6: `packages/api-client`: the log, platform admins and accounts

**Files:**

- Create: `packages/api-client/src/audit-log.ts`, `packages/api-client/src/platform-administration.ts`
- Modify: `packages/api-client/src/index.ts`, `packages/ui/src/lib/messages.ts`, `packages/ui/src/index.ts`
- Test: `packages/api-client/src/audit-log.test.tsx`, `packages/api-client/src/platform-administration.test.tsx`, `packages/ui/src/lib/messages.test.ts`

**Interfaces:**

- Consumes: the generated functions and query keys of Tasks 3, 4 and 5; `refetchMe`; `refetchAdministration`, `accountDeletionBlockers` _(from the organizations plan)_; `apiErrorCode`.
- Produces (from `@padvinder/api-client`):
  - `useAuditLog(filters: { organizationId?: string; actionGroup?: AuditActionGroup }): { entries: AuditLogEntry[]; hasMore: boolean; loadMore(): void; loadingMore: boolean; loadMoreFailed: boolean; isPending: boolean; error: unknown; refetch(): void }`: an infinite query whose key holds the filters, so a changed filter starts at the first page. `entries` is every loaded page in order; the next page is asked with the last page's `nextCursor`. Use the generator's infinite options when it made them for the `cursor` parameter, otherwise `useInfiniteQuery` on the generated function. It does not retry a 404.
  - `usePlatformAdmins()`: the list query.
  - `useAddPlatformAdmin()` (takes the address) and `useRemovePlatformAdmin()` (takes the user ID): mutations that throw the API's error body and, when they settle, refetch the list and call `refetchMe`.
  - `useFindAccount()`: a mutation that takes the address and gives the `AccountSummary`, or `null` for a 404. A mutation, not a query: the address is not kept in the query cache.
  - `useDeleteAccountOf()`: a mutation that takes the user ID, throws the API's error body, and when it settles refetches the platform admins and calls `refetchAdministration`.
- Produces (from `@padvinder/ui`):
  - `accountDeletionBlockedForOtherMessage(name: string, blocker: AccountDeletionBlocker): string`: the two texts in the table at the top.
  - `lastLoggedInPlatformAdminMessage` and `noAccountMessage`: the two texts in that table.
  - `apiErrorMessage` gains `own_account`.

- [ ] **Step 1: Write the failing tests** (`mockFetch`, the fixtures of Tasks 2, 4 and 5).

```ts
test("useAuditLog loads the first page and says whether there is more", ...);
test("loadMore asks with the last cursor and appends the entries", ...); // the second request's query holds cursor=<nextCursor of the first>
test("changing a filter starts again at the first page, without a cursor", ...);
test("a failed loadMore keeps the loaded entries and sets loadMoreFailed", ...);
test("appointing and removing a platform admin refetch the list and me, also after an error", ...);
test("useFindAccount gives null for a 404 and throws for a 403", ...);
test("the address of a lookup is in the request's body, not in its address", ...);
test("a blocked deletion surfaces with its code and blockers", ...); // accountDeletionBlockers(error) has one
test.each([/* the two blocker texts, own_account, the two other texts */])("%j gives %j", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the audit log, platform admins and account deletion to the API client"`

---

### Task 7: `packages/ui`: one sentence per action, and the log's table

**Files:**

- Create: `packages/ui/src/lib/audit-log.ts`, `packages/ui/src/components/audit-log/audit-log-table.tsx`, `audit-log-filters.tsx`, a `.stories.tsx` next to each component
- Modify: `packages/ui/src/index.ts`
- Create (generated): reference images
- Test: `packages/ui/src/lib/audit-log.test.ts`, and next to each component

**Interfaces:**

- Consumes: `AuditLogEntry`, `AuditLogPerson`, `AuditAction`, `AuditActionGroup`, `auditLogFixture` (Task 2); `displayName` with `hasLoggedIn`, the shadcn `select` _(from the organizations plan)_; `formatDateTime`; the `Table` parts.
- Produces (from `@padvinder/ui`):
  - `auditLogPersonName(person: AuditLogPerson): string`: `displayName(name, hasLoggedIn)` for `named`, and the four fixed texts in the table at the top.
  - `auditLogSentence(entry: AuditLogEntry): string`: the sentence table at the top. The sentences live in one object typed `Record<AuditAction, (entry: AuditLogEntry) => string>`, so a pull request that adds an action to `auditActions` does not compile until it has a sentence. An action that is not a key of it gives `entry.action`. A value the sentence needs and the entry lacks gives the shorter sentence or the fallback word, never `undefined`.
  - `auditActionGroupLabels: Record<AuditActionGroup, string>`: `Organisaties`, `Werkgroepen`, `Rollen`, `Leden en aanmeldingen`, `Accounts`, `Soorten`.
  - `AuditLogTable(props: { entries: AuditLogEntry[]; showOrganization: boolean })`: columns `Wanneer` (`formatDateTime`), `Wie` (`auditLogPersonName(entry.actor)`), `Wat` (`auditLogSentence`), and with `showOrganization` the column `Organisatie` (empty for an entry without one). No rows: `Geen regels gevonden.` The table keeps the order it is given.
  - `type AuditLogFilterValue = { organizationId: string | null; actionGroup: AuditActionGroup | null }`
  - `AuditLogFilters(props: { organizations: { id: string; name: string }[]; actionGroups: AuditActionGroup[]; value: AuditLogFilterValue; onChange(value: AuditLogFilterValue): void })`: a select `Organisatie` with `Alle organisaties` first, shown only with more than one organization, and a select `Actie` with `Alle acties` first and then `actionGroups` with their labels.
- Stories: the table (Default with `auditLogFixture`, WithOrganization, Empty), at 1024×768; the filters (ForPlatformAdmin, ForOrganizationAdmin).

- [ ] **Step 1: Write the failing tests.**

```ts
test("every action of auditActions has a sentence that is not its own action text", ...); // over auditLogFixture
test.each([
  ["membership_request.approved", "Aanmelding goedgekeurd: Noor de Vries bij Noord"],
  ["species.updated", "Soort gewijzigd: gewone pat wordt gewone pad"],
  ["membership.removed", "Lid verwijderd: Voormalig lid uit Noord"],
  ["role.platform_admin_granted", "Hoofdbeheerder gemaakt: (nog niet ingelogd)"],
  ["account.deleted", "Account verwijderd"],
])("%s reads %j", ...);
test("an action the page does not know shows its own text", () => {
  expect(auditLogSentence({ ...entry, action: "safety_test.published" })).toBe("safety_test.published");
});
test("working_group.updated with only a city reads 'Werkgroep gewijzigd: Noord, plaats Voorbeeldstad wordt Fictiefdorp'", ...);
test("organization.updated with a new name and contactChanged joins both parts", ...);
test("species.updated with only the check reads 'Soort gewijzigd: kamsalamander, betrouwbaarheidscheck uit'", ...);
test("an entry without its person, working group or details never reads undefined", ...); // every known action with person, workingGroup, organization and species null and details {}
test.each([["named"], ["former_member"], ["deleted_account"], ["platform_admin"], ["system"]])("a %s person reads as the table says", ...);
test("the table shows when, who and what, and the organization only when asked", ...);
test("markup in a name is shown as text", ...);
test("the filters show the organization select only with more than one organization, and call onChange with null for the first option", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm screenshots:update && pnpm test:visual:docker`. Expected: PASS, with new reference images to commit.
- [ ] **Step 5: Commit.** `git commit -m "Add the audit log table with one sentence per action"`

---

### Task 8: `packages/ui`: the platform admins table and the account summary card

**Files:**

- Create: `packages/ui/src/components/administration/platform-admins-table.tsx`, `account-summary-card.tsx`, a `.stories.tsx` next to each
- Modify: `packages/ui/src/index.ts`
- Create (generated): reference images
- Test: next to each file

**Interfaces:**

- Consumes: `PlatformAdmin`, `AccountSummary` and their fixtures (Tasks 4 and 5); `RowMenu`, `displayName` _(from the organizations plan)_; the `Table` parts.
- Produces (from `@padvinder/ui`):
  - `PlatformAdminsTable(props: { admins: PlatformAdmin[]; onRemove(admin: PlatformAdmin): void })`: columns `Naam` (`displayName(name, hasLoggedIn)`), `E-mailadres`, and a last column without a heading with the menu `Acties voor {naam}`, which holds `Verwijder als hoofdbeheerder`.
  - `AccountSummaryCard(props: { account: AccountSummary; own: boolean; onDelete(): void })`: the name (`displayName`) as a heading and the address below it; then `Hoofdbeheerder` when the account is one; one line `Beheerder van {organisatie}` per organization; under `Werkgroepen` one line per working group, `{werkgroep} · {organisatie}`, with `(coördinator)` after it for a coordinator, or `Geen werkgroepen.`; and the button `Verwijder account`. With `own` the text for `own_account` stands in place of the button.
- Stories: the table (Default) at 1024×768; the card (Default, WithoutGroups, Own).

- [ ] **Step 1: Write the failing tests.**

```tsx
test("the menu of a row calls onRemove with that platform admin", ...);
test("someone who never logged in shows (nog niet ingelogd), and the menu is named for that text", ...);
test("the card lists the working groups with their organization and marks a coordinator", ...);
test("an account without working groups shows Geen werkgroepen. and can still be deleted", ...);
test("the own account shows the text and no button", ...);
test("markup in a name is shown as text", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm screenshots:update && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the platform admins table and the account summary card"`

---

### Task 9: Portal: "Logboek"

**Files:**

- Create: `apps/portal/src/pages/audit-log-page.tsx`
- Modify: `apps/portal/src/layout/navigation.ts`, `apps/portal/src/router.tsx`
- Test: `apps/portal/src/pages/audit-log-page.test.tsx`, `apps/portal/src/layout/navigation.test.ts`

**Interfaces:**

- Consumes: Tasks 6 and 7; `useOrganizations` _(from the organizations plan)_; `navigationFor`, `NotFoundPage`, `showToast`, `connectionMessage`.
- Produces:
  - `readsAuditLog(me: MeResponse): boolean` in `navigation.ts`: a platform admin or an admin of at least one organization.
  - `navigationFor(me)` gains `{ label: "Logboek", to: "/audit-log" }` right after `Soorten` in the order of the spec's table, for everyone for whom `readsAuditLog(me)` holds.
  - `/audit-log`: heading `Logboek`, `AuditLogFilters`, `AuditLogTable` with `useAuditLog(filters)` (a `null` in the filter value is an absent filter), and below the table the button `Laad meer` while there is more (`Even geduld…` and disabled while it loads). Someone for whom `readsAuditLog(me)` does not hold sees `NotFoundPage`.
  - The organizations to filter on: for a platform admin `useOrganizations()`, for anyone else `me.organizationAdminOf`. The action groups: all six for a platform admin; without `account` and `species` for anyone else, whose page never holds those. `showOrganization`: more than one organization to filter on and none chosen.
  - The filters live in the page's state, not in the address. The page does not follow live events; it loads again when it is opened.
  - Loading: `Logboek laden…`. A failed load: the connection text with `Probeer opnieuw`. A failed `Laad meer`: the connection text as a toast; the loaded rows stay and the button works again. A 404 (the chosen organization is no longer theirs) sets the organization filter back to `Alle organisaties`.

- [ ] **Step 1: Write the failing tests** (`renderPortal`, `mockFetch`, `auditLogFixture`).

```tsx
test("navigationFor", () => {
  expect(navigationFor(platformAdminMeFixture).map((i) => i.to)).toEqual(["/working-groups", "/organizations", "/species", "/audit-log", "/system"]);
  expect(navigationFor(organizationAdminMe).map((i) => i.label)).toEqual(["Werkgroepen", "Organisatie", "Logboek"]);
  expect(navigationFor(coordinatorMeFixture).map((i) => i.to)).toEqual(["/working-groups"]);
  // with the requests plan merged, "/membership-requests" stands after "/working-groups" in each
});
test("shows when, who and what for each entry", ...);
test("an admin of one organization sees no organization filter, no Organisatie column, and no Accounts or Soorten among the actions", ...);
test("a platform admin chooses an organization and an action, and the request holds both and no cursor", ...);
test("Laad meer asks with the cursor and adds the rows below the ones that were there, each once", ...);
test("without a next cursor there is no Laad meer", ...);
test("a failed Laad meer shows the connection text as a toast and keeps the rows", ...);
test("an entry with an unknown action shows that action's text", ...);
test("a coordinator who opens /audit-log sees the not-found page, and no request for the log was made", ...);
test("when an admin loses the role while the page is open, it turns into the not-found page", ...); // an access-changed event
test("when the chosen organization answers 404, the filter goes back to Alle organisaties", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and look.** `pnpm check && pnpm build`. Then `pnpm dev`, log in on the portal as `beheerder@example.test` and as `hoofdbeheerder@example.test`, and read the log after a few changes. Save a screenshot to `.context/audit-log-page.png`.
- [ ] **Step 5: Commit.** `git commit -m "Add the audit log page to the portal"`

---

### Task 10: Portal: "Hoofdbeheerders" and "Account verwijderen"

**Files:**

- Create: `apps/portal/src/pages/platform-admins-page.tsx`, `apps/portal/src/pages/delete-account-page.tsx`
- Modify: `apps/portal/src/layout/navigation.ts`, `apps/portal/src/router.tsx`
- Test: `apps/portal/src/pages/platform-admins-page.test.tsx`, `apps/portal/src/pages/delete-account-page.test.tsx`, `apps/portal/src/layout/navigation.test.ts`, `apps/portal/src/router.test.ts`

**Interfaces:**

- Consumes: Tasks 6 and 8; `PersonEmailForm`, `accountDeletionBlockers` _(from the organizations plan)_; `RequirePlatformAdmin`, `Modal`, `ConfirmDialog`, `showToast`, `apiErrorMessage`, `apiErrorIssues`, `nameInSentence`.
- Produces:
  - `navigationFor(me)` gains, for a platform admin, `{ label: "Hoofdbeheerders", to: "/platform-admins" }` and `{ label: "Account verwijderen", to: "/delete-account" }`, between `Logboek` and `Systeemstatus`. Both routes are inside `RequirePlatformAdmin`.
  - `/platform-admins`: heading `Hoofdbeheerders`, the text `Een hoofdbeheerder kan alles inzien en wijzigen, in alle organisaties.`, `PlatformAdminsTable` with `usePlatformAdmins()`, and the button `Voeg hoofdbeheerder toe`. Loading: `Hoofdbeheerders laden…`. A failed load: the connection text with `Probeer opnieuw`.
    - `Voeg hoofdbeheerder toe` opens a `Modal` titled `Hoofdbeheerder toevoegen`, in two steps. First `PersonEmailForm` with the hint `Heeft deze persoon nog geen account? Dan wordt het aangemaakt.` and the button `Ga verder`; nothing is sent yet. Then the text `Je maakt {adres} hoofdbeheerder. Controleer het adres: wie hiermee inlogt, kan alles inzien en wijzigen.` with the buttons `Maak hoofdbeheerder` and `Terug`. On success the modal closes and the toast says `{adres} is hoofdbeheerder.` A 400 with an issue on `email` goes back to the first step with `Vul een geldig e-mailadres in.` under the field; any other failure shows `apiErrorMessage(code)` above the buttons of the second step.
    - `Verwijder als hoofdbeheerder` asks with `ConfirmDialog`: title `{naam} verwijderen als hoofdbeheerder?`, text `{naam} kan PadVinder dan niet meer beheren.`, confirm `Verwijder`; the toast is `{naam} is geen hoofdbeheerder meer.`, with `nameInSentence`. On the user's own row: title `Jezelf verwijderen als hoofdbeheerder?`, text `Je kunt PadVinder dan niet meer beheren.`, toast `Je bent geen hoofdbeheerder meer.`; the page then turns into the not-found page, because me no longer has the flag. A 409 `last_platform_admin` shows `lastLoggedInPlatformAdminMessage` in the dialog; any other failure `apiErrorMessage(code)`.
  - `/delete-account`: heading `Account verwijderen`, the text `Zoek het account op het e-mailadres. Dit is voor mensen die hun account niet zelf kunnen verwijderen.`, and `PersonEmailForm` with the button `Zoek`.
    - No account: `Geen account met dit adres.` under the form. An account: `AccountSummaryCard` under the form, with `own` when its ID is the user's own. A new search replaces the result; a failed search shows `apiErrorMessage(code)` in the form.
    - `Verwijder account` asks with `ConfirmDialog`, destructive: title `Account van {naam} verwijderen?`, text `Dit kun je niet terugdraaien.`, confirm `Verwijder account`. `{naam}` is the name, or the address for an account without a name. On success the dialog closes, the form and the result are emptied, and the toast says `Het account van {naam} is verwijderd.`
    - A 409 with blockers shows one sentence per blocker in the dialog (`accountDeletionBlockedForOtherMessage`, joined with a space), and the account stays on the page. Any other failure shows `apiErrorMessage(code)` in the dialog; a 404 there reads `Dit bestaat niet meer.`
    - Nothing is deleted until `Verwijder account` in the dialog is pressed.

- [ ] **Step 1: Write the failing tests** (`renderPortal`, `mockFetch`, with the species page's helper that records every request).

```tsx
test("navigationFor puts Hoofdbeheerders and Account verwijderen between Logboek and Systeemstatus, for a platform admin only", ...);
test("an organization admin who opens /platform-admins or /delete-account sees the not-found page", ...);
// platform-admins-page.test.tsx
test("shows the platform admins, one of them as (nog niet ingelogd)", ...);
test("Ga verder sends nothing; the second step shows the address; Maak hoofdbeheerder posts it and shows the toast", ...);
test("Terug returns to the field with the address still in it, and nothing was sent", ...);
test("'jan@' shows Vul een geldig e-mailadres in. and does not reach the second step", ...);
test("the modal cannot be closed while the appointment runs", ...);
test("removing asks first, and the toast names the person", ...);
test("removing yourself asks Jezelf verwijderen als hoofdbeheerder? and the page turns into the not-found page", ...);
test("a 409 last_platform_admin shows Er moet een hoofdbeheerder blijven die al eens is ingelogd. in the dialog, and the row stays", ...);
// delete-account-page.test.tsx
test("a search shows whose account it is, with its working groups", ...); // the POST body holds the address; no request address does
test("an unknown address shows Geen account met dit adres. and no button", ...);
test("the own account shows the text for own_account and no button", ...);
test("until Verwijder account in the dialog is pressed, only the lookup was sent", ...);
test("confirming deletes, shows the toast with the name, and empties the page", ...);
test("an account without a name is asked about by its address", ...);
test("a blocked deletion shows who must be replaced first, in the dialog, and the account stays", ...);
test("a 404 on the deletion shows Dit bestaat niet meer. in the dialog", ...);
test("the dialog cannot be closed while the deletion runs", ...);
test("no portal route starts with /app or /api", ...); // the existing test still passes
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and look.** `pnpm check && pnpm build`. Then `pnpm dev`, log in on the portal as `hoofdbeheerder@example.test`, appoint a made-up address and remove it again, and look up and delete `dubbel@example.test` (run `pnpm db:seed` afterwards). Save screenshots to `.context/platform-admins-page.png` and `.context/delete-account-page.png`.
- [ ] **Step 5: Commit.** `git commit -m "Add the pages for platform admins and for deleting an account"`

---

### Task 11: End-to-end tests and documentation

**Files:**

- Create: `e2e/portal-audit-log-and-accounts.spec.ts`
- Modify: `AGENTS.md`, `infra/alwaysdata/README.md` (only "Administration tool"), `scripts/lib/ci-jobs.ts` and its test (only if needed: a path no rule names already runs `e2e` and `release`)

**Interfaces:**

- Consumes: `newAddress`, `randomWord`, `createSession`, `runAdmin`, `createWorkingGroup` with `adminAddress` and `coordinatorAddress` _(from the organizations plan)_, `makeVolunteer`; the Playwright project `portal`. A test that also needs the app opens a second browser context with the phone's settings and the app's origin (`MOBILE_PORT`).
- The dev database is shared by every run and worker, and audit entries are never removed: a test finds its own rows by the random name of its own person or working group, never by position or by counting the whole table.

- [ ] **Step 1: Write the tests.**

```ts
test("a platform admin appoints a platform admin, reads it in the log and removes them", async ({
  page,
}) => {
  // A platform admin (runAdmin grant-platform-admin, a session with a random name). Hoofdbeheerders, Voeg hoofdbeheerder toe,
  // a fresh address, Ga verder: the address shows once more; Maak hoofdbeheerder: the toast, and a row "(nog niet ingelogd)" with that address.
  // Logboek, Actie "Rollen": a row with Wie the admin's own name and Wat "Hoofdbeheerder gemaakt: (nog niet ingelogd)".
  // Back on Hoofdbeheerders: Verwijder als hoofdbeheerder on that row, confirm: the toast, and the row is gone.
});
test("an organization admin reads the log of their own organization only", async ({ page }) => {
  // createWorkingGroup(); the session is its adminAddress. Logboek is in the navigation; Hoofdbeheerders and Account verwijderen are not.
  // The table holds "Werkgroep toegevoegd: Groep …" with Wie "Systeem", and every row is about this organization:
  // exactly the four entries the helper wrote. There is no Organisatie filter, and Actie has no "Soorten".
  // /platform-admins and /delete-account show "Deze pagina bestaat niet".
});
test("a platform admin deletes someone's account, and the only coordinator stays", async ({
  page,
  browser,
}) => {
  // A volunteer of a fresh group, with a name (a session in a second context, on the app's Meer tab).
  // Account verwijderen: a part of the address shows "Vul een geldig e-mailadres in."; the whole address shows the name and the working group.
  // Verwijder account, confirm: the toast; the same address again: "Geen account met dit adres."; the volunteer's app shows the login screen.
  // The group's coordinatorAddress: confirm shows "… is de enige coördinator van Groep …" in the dialog; a new search still finds the account.
});
```

- [ ] **Step 2: Run.** `pnpm test:e2e` three times. Expected: PASS each time.
- [ ] **Step 3: Update `AGENTS.md`.**
  - Current state: the portal has the audit log page, the page for platform admins and the page for deleting an account; part 2 of slice 1 is done when the pull requests of `2026-11-25-adding-people.md`, `2026-11-25-requests-in-the-portal.md` and this plan are merged. Say which of them are still open, and remove "a screen to read the audit log, platform admins, and deleting an account for someone" from what is left.
  - Glossary: `logboek` (`auditLog`), and the fixed text `Voormalig lid` (the kind `former_member`), next to "Verwijderd account".
  - Roles and permissions, the audit log: the list of actions is `auditActions` in `packages/contracts`, and a new action needs its sentence in `packages/ui/src/lib/audit-log.ts` (a type error until then) and falls into a filter group by its prefix; `listAuditLogEntries` is the one reader, scoped by organization; who is named in an answer and the four fixed texts; an answer holds no address, phone number or user ID.
  - Roles and permissions: `removePlatformAdmin` next to `revokePlatformAdmin`; deleting an account for someone uses `deleteAccount` with `deletedBy`, obeys the same blockers, and refuses the actor's own account (`own_account`).
  - API and versioning: a long list is paged by a cursor on its sort key, never by an offset, with `listAuditLogEntries` as the example and why its cursor carries microseconds; an email address goes in the body of a request, never in its path or query, with `POST /api/users/lookup` as the example.
  - Frontend, the portal: the three navigation items and `readsAuditLog`.
  - Tests: an end-to-end test finds its own audit entries by a random name.
- [ ] **Step 4: Update `infra/alwaysdata/README.md`,** "Administration tool": platform admins are now appointed and removed in the portal; the tool stays for the first platform admin of an environment and for emergencies.
- [ ] **Step 5: Check the CI rules** (AGENTS.md, "CI"), then run everything: `pnpm check && pnpm build && pnpm test:e2e && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Add end-to-end tests for the audit log and account pages, and document them"`

## Decisions made while planning

The spec leaves these open, or this plan departs from it. The maintainer may overrule each; the task that holds it is named.

1. **The lookup is `POST /api/users/lookup`,** not `GET /users?email=…`, so the address stays out of the request logs (Task 5).
2. **The Dutch sentence is built in `packages/ui`,** from a structured entry; the API holds no Dutch and the answer no user ID (Tasks 2 and 7).
3. **An organization admin sees a name only of someone connected to the entry's own organization,** not to another organization they also administer; a membership of a working group that is switched off counts (Task 2).
4. **A fourth fixed text, "Hoofdbeheerder",** for a platform admin who is not connected to the organization; the spec would call them "Voormalig lid", which they never were (Task 2).
5. **Another organization by filter is 404; the list without a filter is scoped** and empty for who administers nothing, as the other lists are (Task 3).
6. **The filter on kind of action has six groups, by prefix, and is labeled "Actie".** An admin of more than one organization gets the organization filter too; the spec gives it to platform admins (Tasks 2, 7 and 9).
7. **`auditActions` moves to `packages/contracts`** and lists the actions of pull requests 2 and 3a from the start (Task 2).
8. **Appointing a platform admin has a second step that shows the address.** The spec has one step (Task 10).
9. **A platform admin's own account is refused by `DELETE /api/users/{userId}`** (409 `own_account`); removing their own platform admin role is allowed while another who has logged in remains (Tasks 4 and 5).
10. **The page "Hoofdbeheerders" has its own text for `last_platform_admin`,** because "Je bent de enige hoofdbeheerder" is not true when a second one was appointed and has not logged in (Task 10).
11. **The lookup also shows admin roles and working groups that are switched off;** the spec says name and working groups (Task 5).
12. **`account.deleted` reads "Account verwijderd" without a name:** the name is always gone, and the column "Wie" says who did it (Task 7).
13. **The log does not follow live events, its filters are not in the address,** and it gets an index on (`occurred_at`, `id`) for the platform admin's unfiltered page (Tasks 2 and 9).

## Deviations

Recorded while building, 26 November 2026. One line each: what, and why.

- Built on pull requests 3a and 3b, so the navigation tests include "Aanmeldingen" after "Werkgroepen", and `deleteAccount`'s `deletedBy` and the actions `membership.added` and `membership.invited` came from 3a: Task 5 added only a test for `deletedBy` on an account in use, because 3a's tests already pin the rest.
- Task 2: `packages/contracts` also exports `splitAuditLogCursor` and `auditActionGroupSchema`, used by the reader and the query schema. The four new schemas with a component name appear in the OpenAPI file from this task on, before any path uses them.
- Task 2: `details` is answered as stored; `workingGroup` is null for an organization admin when the group is not of the entry's organization. Every writer puts only the entry's own working group in `details`.
- Task 3: the test of a borrowed cursor fills the platform admin's first page with entries without an organization, to borrow a real `nextCursor`.
- Task 6: `useAuditLog` gives `error` only for a failed first load; once rows have loaded, a failed "Laad meer" sets only `loadMoreFailed`. It retries other errors as the default does, never a 404. Its tests and those of `platform-administration.ts` use a local fetch mock that records query and body, because `mockFetch` does not expose them.
- Task 7: the plan's five example sentences are tested on entries built in the test; the fixture uses other names and has its own test that every action reads as a sentence. Species names stay as stored, in lower case ("gewone pad"), as the sentence table asks.
- Task 9: `answerRequests` in `apps/portal/src/testing/requests.ts` answers by query, for the tests of cursors and filters. Going back to "Alle organisaties" after a 404 shows no toast. Reopening the page refetches every loaded page in turn, each with the cursor of the page before, as TanStack Query does.
- Task 10: removing a platform admin uses `mutateAsync`, so removing yourself still shows "Je bent geen hoofdbeheerder meer." after the page turned into the not-found page. The second step, the request and the toast show the address trimmed and in lower case, as the server stores it. A 400 on the address in the search shows "Vul een geldig e-mailadres in." under the field, as on the organization page. `recordRequestAddresses` in `apps/portal/src/testing/requests.ts` records whole request addresses, so the tests check that no `@` is in a path or a query.
- Task 11: `createWorkingGroup()` in `e2e/helpers/working-groups.ts` also returns `organizationName`, so the organization admin's test can check the four sentences the tool wrote. The deletion test waits up to 15 seconds for the volunteer's app to show the login screen: the closed event stream reconnects only after its retry of 5 seconds (`SSE_RETRY_MS`), as long as Playwright's default wait. The appointment test types the address in capitals with spaces around it, and the second step shows it in lower case.
- Accepted, not changed: a 404 on "Laad meer" (the organization was taken away between two presses) shows the connection text as a toast instead of resetting the organization filter. A platform admin's organization filter appears once `useOrganizations()` has loaded, and not when that fails. The reference images of the log table show the rows inside the 1024×768 viewport only.
