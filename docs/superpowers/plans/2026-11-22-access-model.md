# Access Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pull request 2 of "Accounts and access": organizations, working groups, memberships and the four roles; one permission module with a standard test cast; the audit log; a command-line tool for administration; seed data; and the system status and live events limited to the people who may see them.

**Architecture:** Roles are rows, not session state: memberships, organization admin rows and a flag on the user, loaded into `request.actor` on every request. Routes never compare roles; they ask `authorize(actor, permission)`, a pure function with a table of tests. Every change one person makes about another goes through a function in `packages/db` that writes the change and its audit entry in one transaction. Each live event type declares an audience, and the stream delivers by audience with "platform admins only" as the default.

**Tech Stack:** The existing stack. No new dependencies; the command-line tool uses `node:util` `parseArgs`.

**Spec:** `docs/superpowers/specs/2026-11-21-accounts-and-access-design.md` (read it and `AGENTS.md` before starting any task). This plan covers item 2 under "Order of work". It builds on `2026-11-22-login.md` (merged) and is followed by `2026-11-22-joining.md`.

## Global Constraints

- AGENTS.md applies in full: English code, Dutch UI copy with "je", English kebab-case URL paths, glossary terms, naming per location, generated files never edited by hand.
- Run `pnpm check` before every commit. After any change to a route or contract run `pnpm api:generate`; after any schema change run `pnpm db:generate`. Commit the generated files.
- All IDs are `uuid` columns; new tables use `default uuidv7()` (PostgreSQL 18). Every moment is `timestamptz`.
- Tables: `organizations`, `working_groups`, `working_group_memberships`, `organization_admins`, `audit_log_entries`; and `users.is_platform_admin`.
- Glossary additions, in the same pull request: "plaats" → `city`, "lid" → `member`, "lidmaatschap" → `membership`.
- Routes reach the user only through `request.actor`, and decide only through `authorize` or `decide`. A route that compares a role itself is a defect.
- Answers: 401 without a login; 404 for a record the actor may not see at all, including everything in another organization; 403 for a record the actor may see but not change.
- The audit log never holds a name, an email address or a phone number. People appear by ID.
- The API stays backward compatible: only add fields to existing responses.
- Sort Dutch names with `COLLATE "nl-NL-x-icu"`.
- Seed data, fixtures and test addresses are made up and end in `@example.test`. The seed never runs on staging or production.
- Dutch copy in this plan is exact. Where a small text is missing, write it in the same style.
- Commit after every task with a message in English, ending with the co-author line your session's instructions give.

## Review Focus

1. **One person in two organizations.** The actor and `/api/me` carry both memberships, and each permission is decided per working group: being coordinator in one organization gives nothing in the other. Pinned in Task 5 (rules table) and Task 7 (`/api/me`).
2. **The same grant twice, or with different capital letters.** `Carla@Example.test` and `carla@example.test` are one account; granting again changes nothing and writes no second audit entry. Pinned in Task 3.
3. **The last platform admin.** Taking the flag from the only platform admin is refused, so nobody locks everyone out. Pinned in Task 3 and Task 4.
4. **A session that ends while a stream is open.** After logging out, the open event stream receives nothing more and closes at the next check; the app notices and returns to the login screen. Pinned in Task 9.
5. **The database fails while the actor is loaded.** The answer is 500, never 401 or 403: a hiccup must not look like "you are logged out" or "you may not". Pinned in Task 5.

---

### Task 1: Tables for organizations, working groups and roles

**Files:**

- Create: `packages/db/src/schema/organizations.ts`, `packages/db/src/access.ts`
- Modify: `packages/db/src/schema/auth.ts` (add `is_platform_admin`), `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`, `packages/db/src/relations.ts` if a query needs relations, `apps/api/src/auth/auth.ts` (declare the new user field so Better Auth's client cannot set it)
- Create (generated): a migration
- Test: `packages/db/src/access.test.ts`, `packages/db/src/migrate.test.ts`

**Interfaces:**

- Produces (tables):
  - `organizations`: `id`, `name text not null`, `created_at`.
  - `workingGroups` (`working_groups`): `id`, `organization_id` (references `organizations`), `name`, `city`, `active boolean not null default true`, `created_at`; unique on (`organization_id`, `name`).
  - `membershipRole`: a PostgreSQL enum `membership_role` with `volunteer`, `coordinator`.
  - `workingGroupMemberships` (`working_group_memberships`): `id`, `user_id` (references `users`), `working_group_id`, `role`, `created_at`; unique on (`user_id`, `working_group_id`).
  - `organizationAdmins` (`organization_admins`): `user_id`, `organization_id`, `created_at`; primary key on both.
  - `users.is_platform_admin boolean not null default false`.
- Produces (from `@padvinder/db`):
  - `type MembershipRole = "volunteer" | "coordinator"`
  - `type Access = { isPlatformAdmin: boolean; memberships: { membershipId: string; workingGroupId: string; organizationId: string; role: MembershipRole }[]; adminOfOrganizationIds: string[] }`
  - `getAccess(db: Db, userId: string): Promise<Access | null>` (`null` when the user does not exist). Memberships of inactive working groups are left out.

- [ ] **Step 1: Write the failing tests** (insert rows directly; one `createTestDatabase()` per file).

```ts
test("a user without rows has no access", async () =>
  expect(await getAccess(t.db, userId)).toEqual({ isPlatformAdmin: false, memberships: [], adminOfOrganizationIds: [] }));
test("memberships carry the organization of their working group", async () => {
  // member (coordinator) of group A1 in organization A, member (volunteer) of group B1 in organization B
  expect((await getAccess(t.db, userId))?.memberships).toEqual(
    expect.arrayContaining([
      { membershipId: expect.any(String), workingGroupId: a1, organizationId: a, role: "coordinator" },
      { membershipId: expect.any(String), workingGroupId: b1, organizationId: b, role: "volunteer" },
    ]),
  );
});
test("an inactive working group gives no membership", ...);
test("organization admin rows and the platform flag are reported", ...);
test("an unknown user is null", ...);
test("one user cannot be a member of one group twice", ...); // second insert rejects
// migrate.test.ts (add): the migration applies to a database that already holds users and sessions
```

- [ ] **Step 2: Run them.** `pnpm test packages/db`. Expected: FAIL.
- [ ] **Step 3: Write the schema, run `pnpm db:generate`, read the SQL, implement `getAccess`.**
- [ ] **Step 4: Run.** `pnpm db:migrate && pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add organizations, working groups, memberships and admin rows"`

---

### Task 2: The audit log

**Files:**

- Create: `packages/db/src/schema/audit-log.ts`, `packages/db/src/audit-log.ts`
- Create (generated, plus one custom migration for the trigger)
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/audit-log.test.ts`

**Interfaces:**

- Produces (table) `auditLogEntries` (`audit_log_entries`): `id uuid primary key default uuidv7()`, `occurred_at timestamptz not null default now()`, `actor_kind` (enum `audit_actor_kind`: `user`, `system`), `actor_user_id uuid` (nullable, references `users`), `organization_id uuid` (nullable, references `organizations`), `action text not null`, `subject_type text not null`, `subject_id uuid not null`, `details jsonb not null default '{}'`. Indexes on (`organization_id`, `occurred_at`) and (`subject_type`, `subject_id`).
- A trigger makes the table append-only: `UPDATE` and `DELETE` raise an exception. Write it in a custom migration (`drizzle-kit generate --custom --name audit_log_append_only`).
- Produces (from `@padvinder/db`):
  - `type AuditActor = { kind: "user"; userId: string } | { kind: "system" }`
  - `type AuditAction`: a union of the action names. In this plan: `"organization.created"`, `"working_group.created"`, `"role.platform_admin_granted"`, `"role.platform_admin_revoked"`, `"role.organization_admin_granted"`, `"role.organization_admin_revoked"`, `"role.coordinator_granted"`, `"role.coordinator_revoked"`. Plan 3 adds more.
  - `type AuditSubject = { type: "user" | "organization" | "working_group" | "membership" | "membership_request"; id: string }`
  - `type AuditDetails = Record<string, string | number | boolean | null>`
  - `recordAudit(tx: DbTransaction, entry: { actor: AuditActor; organizationId: string | null; action: AuditAction; subject: AuditSubject; details?: AuditDetails }): Promise<void>`. It takes the transaction, like `notify`, never the plain `db`. It throws when `details` has a key named `name`, `email` or `phone`, or a text value that contains `@`.

- [ ] **Step 1: Write the failing tests.**

```ts
test("writes one entry inside the transaction", async () => {
  await t.db.transaction((tx) =>
    recordAudit(tx, { actor: { kind: "system" }, organizationId: null, action: "organization.created", subject: { type: "organization", id }, details: { source: "cli" } }),
  );
  expect(await t.db.select().from(auditLogEntries)).toMatchObject([
    { actorKind: "system", actorUserId: null, action: "organization.created", subjectType: "organization", subjectId: id, details: { source: "cli" } },
  ]);
});
test("nothing is written when the transaction rolls back", ...);
test("an entry cannot be updated", async () =>
  await expect(t.db.update(auditLogEntries).set({ action: "x" })).rejects.toThrow());
test("an entry cannot be deleted", async () =>
  await expect(t.db.delete(auditLogEntries)).rejects.toThrow());
test.each([[{ name: "Noor" }], [{ email: "x" }], [{ phone: "06" }], [{ note: "noor@example.test" }]])(
  "refuses personal data in details: %j",
  async (details) => await expect(t.db.transaction((tx) => recordAudit(tx, { ...entry, details }))).rejects.toThrow(/personal data/),
);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Check that dropping a cloned test database still works with the trigger in place (it does not delete rows, but run the suite to be sure).
- [ ] **Step 4: Run.** `pnpm db:migrate && pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the append-only audit log"`

---

### Task 3: Administration functions

**Files:**

- Create: `packages/db/src/admin.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/admin.test.ts`

**Interfaces:**

- Consumes: the tables (Task 1), `recordAudit`, `AuditActor` (Task 2).
- Produces (from `@padvinder/db`). Every function runs in one transaction and writes its audit entry there. A function that changes nothing writes no entry and reports `changed: false`.
  - `class AdminError extends Error { code: "organization_not_found" | "working_group_not_found" | "user_not_found" | "name_taken" | "last_platform_admin" }`
  - `normalizeEmail(email: string): string` (trim, lowercase)
  - `createOrganization(db: Db, input: { name: string }, actor: AuditActor): Promise<{ id: string }>`
  - `createWorkingGroup(db: Db, input: { organizationId: string; name: string; city: string }, actor: AuditActor): Promise<{ id: string }>` (`name_taken` when the organization already has a group with that name)
  - `listOrganizations(db: Db): Promise<{ id: string; name: string; workingGroups: { id: string; name: string; city: string; active: boolean }[] }[]>`
  - `grantPlatformAdmin(db, input: { email: string }, actor): Promise<{ userId: string; changed: boolean }>`
  - `revokePlatformAdmin(db, input: { email: string }, actor): Promise<{ userId: string; changed: boolean }>` (`last_platform_admin` when it would leave none)
  - `grantOrganizationAdmin(db, input: { email: string; organizationId: string }, actor)`, `revokeOrganizationAdmin(...)`: same result shape
  - `grantCoordinator(db, input: { email: string; workingGroupId: string }, actor)`: creates the membership with role `coordinator`, or raises an existing `volunteer` membership
  - `revokeCoordinator(db, input: { email: string; workingGroupId: string }, actor)`: the membership stays, with role `volunteer`
- Granting to an address without an account creates the account: a `users` row with the normalized address, an empty name, `email_verified` false. Revoking for an unknown address throws `user_not_found`.
- Audit entries: `organization_id` is the organization concerned (`null` for platform admin changes); the subject is the user for role changes; `details` holds the working group ID for coordinator changes.

- [ ] **Step 1: Write the failing tests.**

```ts
const system: AuditActor = { kind: "system" };
test("creates an organization and a working group, each with an audit entry", ...);
test("a second working group with the same name in one organization is name_taken", ...);
test("the same name in another organization is fine", ...);
test("granting platform admin to an unknown address creates the account", async () => {
  const { userId, changed } = await grantPlatformAdmin(t.db, { email: "Eerste@Example.test" }, system);
  expect(changed).toBe(true);
  expect((await getAccess(t.db, userId))?.isPlatformAdmin).toBe(true);
  expect(await t.db.select().from(users)).toMatchObject([{ email: "eerste@example.test", name: "" }]);
});
test("the same grant again changes nothing and writes no second entry", async () => {
  await grantPlatformAdmin(t.db, { email: "a@example.test" }, system);
  expect((await grantPlatformAdmin(t.db, { email: " A@Example.TEST" }, system)).changed).toBe(false);
  expect(await t.db.select().from(users)).toHaveLength(1);
  expect(await t.db.select().from(auditLogEntries)).toHaveLength(1);
});
test("the last platform admin cannot be revoked", async () =>
  await expect(revokePlatformAdmin(t.db, { email: "a@example.test" }, system)).rejects.toMatchObject({ code: "last_platform_admin" }));
test("with two platform admins one can be revoked", ...);
test("grantCoordinator creates the membership, or raises a volunteer", ...);
test("revokeCoordinator leaves a volunteer membership", ...);
test("organization admin can be granted and revoked", ...);
test("an unknown organization or working group is reported by code", ...);
test("the audit entry of a coordinator grant names the organization and the group, and no person by name", async () => {
  // entry: action role.coordinator_granted, organizationId = the group's, subject { type: "user", id }, details { workingGroupId }
  expect(JSON.stringify(entry)).not.toContain("example.test");
});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add administration functions with audit entries"`

---

### Task 4: The command-line tool

**Files:**

- Create: `apps/api/src/cli/admin.ts`, `apps/api/src/cli/run-admin-command.ts`
- Modify: `apps/api/package.json` (script `admin`), root `package.json` (script `admin`), `apps/api/tsdown.config.ts` (a second entry, so the build also gives `dist/admin.js`)
- Test: `apps/api/src/cli/run-admin-command.test.ts`

**Interfaces:**

- Consumes: Task 3's functions.
- Produces:
  - `runAdminCommand(argv: string[], deps: { db: Db; out(line: string): void; err(line: string): void }): Promise<number>` (the exit code). All work happens here so it can be tested; `admin.ts` only loads `DATABASE_URL`, opens the pool, calls it and exits.
  - `pnpm admin <command>`, run from the repository root, with these commands. Text is English: this is a tool for the maintainer.

| Command                                                                     | Does                                    | Prints on stdout            |
| --------------------------------------------------------------------------- | --------------------------------------- | --------------------------- |
| `list`                                                                      | Organizations with their working groups | One line each, with the IDs |
| `create-organization --name <name>`                                         | Creates it                              | Only the new ID             |
| `create-working-group --organization <id> --name <name> --city <city>`      | Creates it                              | Only the new ID             |
| `grant-platform-admin --email <address>`, `revoke-platform-admin --email …` | Sets or clears the flag                 | `changed` or `unchanged`    |
| `grant-organization-admin --email … --organization <id>`, `revoke-…`        | Adds or removes the row                 | `changed` or `unchanged`    |
| `grant-coordinator --email … --working-group <id>`, `revoke-coordinator …`  | Sets the role                           | `changed` or `unchanged`    |

- Exit code 0 on success. An `AdminError`, an unknown command or a missing option prints one line to stderr and exits 1; `--help` or no command prints the table above and exits 0.
- Every command writes its audit entry with actor `{ kind: "system" }`.
- The built tool must run on the server from the release directory (`node dist/admin.js …` with the environment file). Note this in the pull request for the deployment work (the spec, "What deployment needs").

- [ ] **Step 1: Write the failing tests** (a test database; `out` and `err` collect lines).

```ts
test("create-organization prints only the new id", async () => {
  expect(await runAdminCommand(["create-organization", "--name", "Paddentrek Voorbeeldstad"], deps)).toBe(0);
  expect(out).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/)]);
});
test("create-working-group, grant-coordinator and list work together", ...);
// list shows the organization, the group "Noord (Voorbeeldstad)" and both ids
test("grant twice prints changed, then unchanged", ...);
test("revoking the last platform admin exits 1 with a clear line", async () => {
  expect(await runAdminCommand(["revoke-platform-admin", "--email", "a@example.test"], deps)).toBe(1);
  expect(err.join("\n")).toMatch(/last platform admin/i);
});
test("a missing option exits 1 and names the option", ...);
test("an unknown command exits 1", ...);
test("no command prints the help and exits 0", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and try.** `pnpm check`, then `pnpm admin list` and `pnpm admin create-organization --name "Probeer"`. Then `pnpm --filter @padvinder/api build && node --env-file=.env apps/api/dist/admin.js list`. Expected: all work; the built file lists the organization.
- [ ] **Step 5: Commit.** `git commit -m "Add the admin command-line tool"`

---

### Task 5: The actor and the permission rules

**Files:**

- Create: `apps/api/src/permissions/rules.ts`
- Modify: `apps/api/src/permissions/actor.ts`
- Test: `apps/api/src/permissions/rules.test.ts`, `apps/api/src/permissions/actor.test.ts`

**Interfaces:**

- Consumes: `getAccess`, `Access`, `MembershipRole` (Task 1); `apiError` (plan 1).
- Produces:
  - `type Actor = { userId: string } & Access`. `loadActor` now also calls `getAccess`.
  - `type WorkingGroupTarget = { workingGroupId: string; organizationId: string }`
  - `type Relation = "platformAdmin" | "organizationAdmin" | "coordinator" | "volunteer" | "outsider"`
  - `relationTo(actor: Actor, target: WorkingGroupTarget): Relation` (the strongest one that applies, in that order)
  - `type Permission = { action: "system.viewDatabaseDetails" } | { action: "workingGroup.listMembers"; target: WorkingGroupTarget } | { action: "workingGroup.viewMemberContact"; target: WorkingGroupTarget } | { action: "workingGroup.reviewRequests"; target: WorkingGroupTarget } | { action: "workingGroup.removeMember"; target: WorkingGroupTarget; memberRole: MembershipRole }`
  - `type Decision = "allowed" | "forbidden" | "hidden"`
  - `decide(actor: Actor, permission: Permission): Decision`
  - `authorize(actor: Actor, permission: Permission): void`: throws `apiError(404, "not_found", …)` for `hidden` and `apiError(403, "not_allowed", …)` for `forbidden`.
- The rules (the spec's table, "Permissions"). `reviewRequests` covers listing requests with contact details, approving and rejecting.

| Action                           | outsider | volunteer | coordinator                                          | organizationAdmin | platformAdmin |
| -------------------------------- | -------- | --------- | ---------------------------------------------------- | ----------------- | ------------- |
| `workingGroup.listMembers`       | hidden   | allowed   | allowed                                              | allowed           | allowed       |
| `workingGroup.viewMemberContact` | hidden   | forbidden | allowed                                              | allowed           | allowed       |
| `workingGroup.reviewRequests`    | hidden   | forbidden | allowed                                              | allowed           | allowed       |
| `workingGroup.removeMember`      | hidden   | forbidden | allowed for a volunteer, forbidden for a coordinator | allowed           | allowed       |

`system.viewDatabaseDetails` is `allowed` for a platform admin and `forbidden` for everyone else.

- [ ] **Step 1: Write the failing tests.**

```ts
// rules.test.ts: actors built by hand, no database
const target = { workingGroupId: "g-a1", organizationId: "o-a" };
const actors = {
  platformAdmin: actor({ isPlatformAdmin: true }),
  organizationAdmin: actor({ adminOfOrganizationIds: ["o-a"] }),
  coordinator: actor({ memberships: [m("g-a1", "o-a", "coordinator")] }),
  volunteer: actor({ memberships: [m("g-a1", "o-a", "volunteer")] }),
  volunteerOtherGroup: actor({ memberships: [m("g-a2", "o-a", "volunteer")] }),
  coordinatorOtherOrganization: actor({ memberships: [m("g-b1", "o-b", "coordinator")] }),
  adminOtherOrganization: actor({ adminOfOrganizationIds: ["o-b"] }),
  applicant: actor({}),
};
test.each([
  ["workingGroup.listMembers", { platformAdmin: "allowed", organizationAdmin: "allowed", coordinator: "allowed", volunteer: "allowed", volunteerOtherGroup: "hidden", coordinatorOtherOrganization: "hidden", adminOtherOrganization: "hidden", applicant: "hidden" }],
  ["workingGroup.viewMemberContact", { platformAdmin: "allowed", organizationAdmin: "allowed", coordinator: "allowed", volunteer: "forbidden", volunteerOtherGroup: "hidden", coordinatorOtherOrganization: "hidden", adminOtherOrganization: "hidden", applicant: "hidden" }],
  ["workingGroup.reviewRequests", { platformAdmin: "allowed", organizationAdmin: "allowed", coordinator: "allowed", volunteer: "forbidden", volunteerOtherGroup: "hidden", coordinatorOtherOrganization: "hidden", adminOtherOrganization: "hidden", applicant: "hidden" }],
] as const)("%s", (action, expected) => {
  for (const [who, decision] of Object.entries(expected)) expect(decide(actors[who], { action, target }), who).toBe(decision);
});
test("a coordinator removes a volunteer but not a coordinator", () => {
  expect(decide(actors.coordinator, { action: "workingGroup.removeMember", target, memberRole: "volunteer" })).toBe("allowed");
  expect(decide(actors.coordinator, { action: "workingGroup.removeMember", target, memberRole: "coordinator" })).toBe("forbidden");
  expect(decide(actors.organizationAdmin, { action: "workingGroup.removeMember", target, memberRole: "coordinator" })).toBe("allowed");
});
test("a coordinator in one organization is an outsider in the other", () => {
  const both = actor({ memberships: [m("g-a1", "o-a", "coordinator"), m("g-b1", "o-b", "volunteer")] });
  expect(relationTo(both, target)).toBe("coordinator");
  expect(relationTo(both, { workingGroupId: "g-b1", organizationId: "o-b" })).toBe("volunteer");
  expect(relationTo(both, { workingGroupId: "g-b2", organizationId: "o-b" })).toBe("outsider");
});
test("only a platform admin sees database details", ...);
test("authorize throws 404 for hidden and 403 for forbidden", ...);

// actor.test.ts (add)
test("the actor carries memberships, admin rows and the platform flag", ...);
test("a database failure while loading access is 500, not 401 or 403", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the permission rules and the full actor"`

---

### Task 6: The standard cast for permission tests

**Files:**

- Create: `apps/api/src/testing/cast.ts`
- Test: `apps/api/src/testing/cast.test.ts`

**Interfaces:**

- Consumes: `createTestApp`, `loginAs` (plan 1); Task 3's functions.
- Produces:
  - `type CastMember = "platformAdmin" | "organizationAdmin" | "coordinator" | "volunteer" | "volunteerOtherGroup" | "coordinatorOtherOrganization" | "applicant"`
  - `type Cast = { organization: { id: string }; otherOrganization: { id: string }; workingGroup: WorkingGroupTarget; otherGroup: WorkingGroupTarget; foreignGroup: WorkingGroupTarget; members: Record<CastMember, { userId: string; email: string; headers: { cookie: string } }> }`. `workingGroup` and `otherGroup` are in `organization`; `foreignGroup` is in `otherOrganization`. `volunteer` and `coordinator` belong to `workingGroup`.
  - `createCast(ctx: TestApp): Promise<Cast>`
  - `expectStatuses(cast: Cast, expected: Record<CastMember | "anonymous", number>, send: (headers: Record<string, string>) => Promise<{ statusCode: number }>): Promise<void>`: sends once per cast member and once without a cookie, and fails with the member's name when a status differs. `expected` must name every member, so a new endpoint cannot skip one.
- Every endpoint behind a permission, in this plan and later ones, gets one `expectStatuses` test. Say so in AGENTS.md (Task 11).

- [ ] **Step 1: Write the failing test.**

```ts
test("the cast has the roles it says", async () => {
  const cast = await createCast(ctx);
  const access = (who: CastMember) => getAccess(ctx.t.db, cast.members[who].userId);
  expect((await access("platformAdmin"))?.isPlatformAdmin).toBe(true);
  expect((await access("organizationAdmin"))?.adminOfOrganizationIds).toEqual([cast.organization.id]);
  expect((await access("coordinator"))?.memberships).toMatchObject([{ workingGroupId: cast.workingGroup.workingGroupId, role: "coordinator" }]);
  expect((await access("volunteerOtherGroup"))?.memberships).toMatchObject([{ workingGroupId: cast.otherGroup.workingGroupId }]);
  expect((await access("coordinatorOtherOrganization"))?.memberships).toMatchObject([{ organizationId: cast.otherOrganization.id }]);
  expect((await access("applicant"))?.memberships).toEqual([]);
});
test("expectStatuses names the member whose status differs", ...);
```

- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the standard cast for permission tests"`

---

### Task 7: `/api/me` with memberships and roles

**Files:**

- Create: `packages/contracts/src/working-groups.ts`, `packages/db/src/me.ts`
- Modify: `packages/contracts/src/me.ts`, `packages/contracts/src/fixtures/me.ts`, `packages/contracts/src/index.ts`, `packages/db/src/index.ts`, `apps/api/src/routes/me.ts`
- Create (generated): the OpenAPI file and client
- Test: `packages/db/src/me.test.ts`, `apps/api/src/routes/me.test.ts`, `packages/contracts/src/fixtures/me.test.ts`

**Interfaces:**

- Produces (contracts):
  - `membershipRoleSchema = z.enum(["volunteer", "coordinator"])`
  - `workingGroupSummarySchema` (component `WorkingGroupSummary`): `{ id: string; name: string; city: string; organization: { id: string; name: string } }`
  - `meResponseSchema` gains, next to `user`: `user.isPlatformAdmin: boolean`; `memberships: { id: string; role: MembershipRole; workingGroup: WorkingGroupSummary }[]`; `organizationAdminOf: { id: string; name: string }[]`.
  - Fixtures: `meFixture` becomes a volunteer of one group ("Noord", "Voorbeeldstad", organization "Paddentrek Voorbeeldstad"); add `coordinatorMeFixture`, `platformAdminMeFixture`, `applicantMeFixture` (no memberships), `twoOrganizationsMeFixture`. `meWithoutNameFixture` stays.
- Produces (from `@padvinder/db`): `getMe(db: Db, userId: string): Promise<MeDetails | null>` with the same shape as the response. Memberships are sorted by organization name, then working group name, in Dutch order; inactive groups are left out.

- [ ] **Step 1: Write the failing tests.**

```ts
// routes/me.test.ts (add; uses the cast)
test("a volunteer sees their one membership", async () => {
  const res = await ctx.app.inject({ url: "/api/me", headers: cast.members.volunteer.headers });
  expect(res.json()).toMatchObject({
    user: { isPlatformAdmin: false },
    memberships: [{ role: "volunteer", workingGroup: { id: cast.workingGroup.workingGroupId, organization: { id: cast.organization.id } } }],
    organizationAdminOf: [],
  });
});
test("someone in two organizations sees both memberships", ...); // grantCoordinator in foreignGroup for the volunteer
test("an organization admin sees the organization", ...);
test("a platform admin has the flag", ...);
test("an applicant has empty lists", ...);
test("PATCH still returns the full shape", ...);
// fixtures: every me fixture parses with meResponseSchema
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`. Fix the tests in the apps that use `meFixture`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Report memberships and roles in /api/me"`

---

### Task 8: System status for platform admins only

**Files:**

- Modify: `packages/contracts/src/health.ts`, `packages/contracts/src/fixtures/health.ts`, `apps/api/src/routes/health.ts`, `packages/ui/src/components/health-status.tsx` and its stories, `apps/mobile/src/screens/more-screen.tsx`, `apps/portal/src/pages/home-page.tsx`, `apps/portal/src/pages/system-page.tsx`
- Create (generated): the OpenAPI file and client
- Test: `apps/api/src/routes/health.test.ts`, `packages/ui/src/components/health-status.test.tsx`, `apps/mobile/src/screens/more-screen.test.tsx`, `apps/portal/src/pages/*.test.tsx`

**Interfaces:**

- Consumes: `loadActor`, `decide` (Task 5); `useMe` (plan 1).
- Produces:
  - `healthResponseSchema.database` gains `detailsHidden: boolean`. When `true`, `postgresVersion`, `postgisVersion` and `latestMigration` are `null`. `reachable`, `status`, `commit` and the worker heartbeat are unchanged and public: the deploy check reads them without a login.
  - `GET /api/health` loads the actor when there is a session, without requiring one. Details are filled only when `decide(actor, { action: "system.viewDatabaseDetails" })` is `allowed`. A failure to load the actor counts as "no actor"; the endpoint must keep answering when the database is down.
  - A new fixture `detailsHiddenFixture`. `HealthStatus` leaves out the rows `PostgreSQL`, `PostGIS` and `Laatste migratie` when `detailsHidden` is `true`; a new story `DetailsHidden`.
  - Mobile: the Meer tab shows the system status only when `me.user.isPlatformAdmin`.
  - Portal home page: a platform admin sees the link `Systeemstatus`; everyone else sees `Hier is nog niets te doen. Het beheer komt binnenkort.` Both see `Log uit`.
  - Portal `/system`: anyone who is not a platform admin sees `Je hebt geen toegang tot deze pagina.` and a link `Terug` to the home page.

- [ ] **Step 1: Write the failing tests.**

```ts
// health.test.ts
test("without a login the details are hidden but the status is there", async () => {
  await recordHeartbeat(ctx.t.db);
  const body = (await ctx.app.inject("/api/health")).json();
  expect(body).toMatchObject({ status: "ok", commit: "test-commit", database: { reachable: true, detailsHidden: true, postgresVersion: null, postgisVersion: null, latestMigration: null } });
  expect(body.worker.lastHeartbeatAt).not.toBeNull();
});
test("a volunteer gets the same as nobody", ...);
test("a platform admin gets the details", ...); // detailsHidden false, postgisVersion matches /^3\./
test("the endpoint still answers 503 when the database is down, with a session cookie present", ...);

// health-status.test.tsx
test("hidden details leave the version rows out", () => {
  render(<HealthStatus health={detailsHiddenFixture} />);
  expect(screen.queryByText("PostGIS")).toBeNull();
  expect(screen.getByText("Verbonden")).toBeVisible();
});
// mobile and portal: with meFixture no system status; with platformAdminMeFixture it shows
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check && pnpm storybook:build`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Limit database details and system status to platform admins"`

---

### Task 9: Live events by audience

**Files:**

- Create: `apps/api/src/realtime/audience.ts`
- Modify: `packages/contracts/src/events.ts`, `apps/api/src/routes/events.ts`, `packages/api-client/src/server-events.ts`, `packages/api-client/src/health-live-updates.ts`
- Test: `packages/contracts/src/events.test.ts`, `apps/api/src/realtime/audience.test.ts`, `apps/api/src/routes/events.test.ts`, `packages/api-client/src/server-events.test.ts`

**Interfaces:**

- Consumes: `Actor`, `relationTo` (Task 5), `loadActor`.
- Produces (contracts):
  - `type LiveEventAudience = "user" | "working-group-coordinators" | "working-group-members" | "organization" | "platform-admins"`
  - `liveEventAudiences: Partial<Record<LiveEventType, LiveEventAudience>>`, with `"worker-heartbeat": "platform-admins"`.
  - `audienceOf(type: LiveEventType): LiveEventAudience`: the declared audience, or `"platform-admins"` when none is declared.
  - A comment at the union explains: an event for `user` carries `userId`; for the two working-group audiences `workingGroupId` and `organizationId`; for `organization` `organizationId`.
- Produces (API):
  - `shouldDeliver(actor: Actor, audience: LiveEventAudience, address: { userId?: string; workingGroupId?: string; organizationId?: string }): boolean`. Platform admins receive everything. `user`: `address.userId === actor.userId`. `working-group-coordinators`: relation is coordinator or organization admin. `working-group-members`: relation is anything but outsider. `organization`: a membership or admin row in that organization. An address that lacks the field its audience needs is delivered to platform admins only.
  - The stream loads the actor when it opens and filters every event with `shouldDeliver`. Every `SESSION_RECHECK_MS = 300_000` it loads the actor again: gone means the stream ends; otherwise the fresh actor replaces the old one. `AppDeps` gains an optional `sessionRecheckMs?: number` (default `SESSION_RECHECK_MS`) so a test can use a short interval.
- Produces (client): `ServerEventHandlers` gains `onClosed?: () => void`, called when the browser gives up on the stream (the server answered with a non-200 status, so `readyState` is closed). The apps refetch me in it, so a closed stream after a logout elsewhere leads to the login screen. Wire that into the shared query client setup from plan 1.

- [ ] **Step 1: Write the failing tests.**

```ts
// audience.test.ts (actors as in Task 5's test)
const address = { workingGroupId: "g-a1", organizationId: "o-a", userId: "u-volunteer" };
test.each([
  ["user", ["platformAdmin", "volunteer"]],
  ["working-group-coordinators", ["platformAdmin", "organizationAdmin", "coordinator"]],
  ["working-group-members", ["platformAdmin", "organizationAdmin", "coordinator", "volunteer"]],
  ["organization", ["platformAdmin", "organizationAdmin", "coordinator", "volunteer", "volunteerOtherGroup"]],
  ["platform-admins", ["platformAdmin"]],
] as const)("%s reaches exactly %j", (audience, expected) => {
  const reached = Object.entries(actors).filter(([, a]) => shouldDeliver(a, audience, address)).map(([who]) => who);
  expect(reached.sort()).toEqual([...expected].sort());
});
test("an address without the needed field reaches platform admins only", ...);

// contracts events.test.ts
test("an event type without a declared audience is for platform admins", ...);

// routes/events.test.ts
test("a volunteer does not receive the worker heartbeat", ...); // open the stream as volunteer, record a beat, nothing within 500 ms
test("a platform admin does", ...);
test("after logging out the stream gets nothing and ends at the next check", ...);
// build the app with sessionRecheckMs: 200

// server-events.test.ts
test("onClosed is called when the stream is closed for good", ...); // fake EventSource with readyState 2 on error
test("onClosed is not called while the browser is reconnecting", ...); // readyState 0
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Deliver live events by audience"`

---

### Task 10: Seed data

**Files:**

- Modify: `packages/db/src/seed.ts`, `packages/db/src/cli/seed.ts`
- Test: `packages/db/src/seed.test.ts`

**Interfaces:**

- Consumes: Task 3's functions, `updateUserProfile`.
- Produces: `seed(db)` creates, idempotently, through the administration functions (actor `system`):

| Organization                | Working group | City          |
| --------------------------- | ------------- | ------------- |
| Paddentrek Voorbeeldstad    | Noord         | Voorbeeldstad |
| Paddentrek Voorbeeldstad    | Zuid          | Voorbeeldstad |
| Paddenwerkgroep Fictiefdorp | Dorp          | Fictiefdorp   |

| Address                       | Name              | Role                                               |
| ----------------------------- | ----------------- | -------------------------------------------------- |
| `hoofdbeheerder@example.test` | Hanna Hoofd       | Platform admin                                     |
| `beheerder@example.test`      | Bram Beheer       | Organization admin of Paddentrek Voorbeeldstad     |
| `coordinator@example.test`    | Carla Coördinator | Coordinator of Noord                               |
| `vrijwilliger@example.test`   | Vera Vrijwilliger | Volunteer of Noord                                 |
| `dubbel@example.test`         | Daan Dubbel       | Volunteer of Zuid and of Dorp (two organizations)  |
| `aanmelder@example.test`      | Noor Nieuw        | No membership (plan 3 gives her a pending request) |

- `packages/db/src/cli/seed.ts` refuses to run when `PUBLIC_ORIGIN` starts with `https://`, with the message `The seed is for local development only.`

- [ ] **Step 1: Write the failing tests.**

```ts
test("the seed creates the organizations, groups and people", async () => {
  await seed(t.db);
  expect(await listOrganizations(t.db)).toHaveLength(2);
  expect(await t.db.select().from(users)).toHaveLength(6);
});
test("running it twice changes nothing", async () => {
  await seed(t.db); await seed(t.db);
  expect(await t.db.select().from(users)).toHaveLength(6);
  expect(await t.db.select().from(workingGroupMemberships)).toHaveLength(4);
});
test("every address ends in @example.test", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and try.** `pnpm check && pnpm db:seed && pnpm admin list`. Then log in locally as `hoofdbeheerder@example.test` (code from the Mailpit inbox) and check that the Meer tab shows the system status; log in as `vrijwilliger@example.test` and check that it does not.
- [ ] **Step 5: Commit.** `git commit -m "Seed made-up organizations, groups and people"`

---

### Task 11: End-to-end tests and documentation

**Files:**

- Create: `e2e/helpers/admin.ts`
- Modify: `e2e/mobile-system-status.spec.ts`, `AGENTS.md`

**Interfaces:**

- Produces: `runAdmin(...args: string[]): string`: runs `pnpm --silent admin …` from the repository root and returns trimmed stdout; throws with stderr on a non-zero exit. Tests make their own platform admin with it (`runAdmin("grant-platform-admin", "--email", address)`) instead of using a seeded address, because all workspaces share one Mailpit inbox.

- [ ] **Step 1: Update the tests.**

```ts
test("a platform admin sees a working system on the Meer tab", async ({ page, context }) => {
  const address = newAddress("admin");
  runAdmin("grant-platform-admin", "--email", address);
  await createSession(context, address);
  await page.goto("/app/more");
  await expect(page.getByText("Alles werkt")).toBeVisible({ timeout: 15_000 });
});
test("a volunteer does not see the system status", ...); // createSession with a fresh address: no "Systeemstatus" heading
```

- [ ] **Step 2: Run.** `pnpm test:e2e` three times. Expected: PASS each time.
- [ ] **Step 3: Update `AGENTS.md`.**
  - Glossary: plaats → `city`, lid → `member`, lidmaatschap → `membership`.
  - Replace the names rule under "Multi-tenancy, permissions and privacy" with the rule from the spec ("Who sees names").
  - New short sections: how roles are stored; the permission module (`request.actor`, `authorize`, `decide`, the 401, 403 and 404 rule) with `apps/api/src/permissions/rules.ts` as the reference; the test cast and "every endpoint behind a permission has one `expectStatuses` test"; the audit log (`recordAudit` takes the transaction; no personal data in `details`; what to record); live event audiences and the default; `pnpm admin` with its commands; the seeded people and how to log in as one.
  - Update the reference example notes: the health details and the heartbeat event are for platform admins.
- [ ] **Step 4: Run everything.** `pnpm check && pnpm build && pnpm test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Document the access model and update the end-to-end tests"`
