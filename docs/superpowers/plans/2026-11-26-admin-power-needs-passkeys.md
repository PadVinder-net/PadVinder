# Admin Power Needs Passkeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pull request 2 of "A stronger login for admins: passkeys". Admin power now depends on a passkey used in the last 24 hours, in that session, and the actions that cannot be undone on one used in the last 10 minutes. An unconfirmed admin falls back to what they are besides admin. Wherever a confirmation would show more, the apps say so with a grey bar and an eye button.

**Architecture:** One rule in `decide` turns every admin decision that holds only because of an admin relation into `confirm` while the session is not confirmed. It works by deciding again without the admin roles, so an admin who is also the group's coordinator keeps that group. Routes keep calling `authorize` and `decide` as they do; no route reads a window. Lists whose scope grows through admin roles ask `decide` first, through one new permission, before they read anything. A field that depends on a role is left out on `confirm`, and the response names it in `passkeyReveals`. The event stream delivers by the actor's effective roles. In the clients, the confirmation hook of pull request 1 now refetches everything on screen after a confirmation. The app's lists load the groups of administered organizations only while `adminConfirmedUntil` lies in the future. One shared component shows what is hidden.

**Tech Stack:** The existing stack. No new dependency, except `pg` as a root devDependency for one end-to-end helper (Task 10).

**Spec:** `docs/superpowers/specs/2026-11-26-passkeys-for-admins-design.md`. Read it, `AGENTS.md`, and the plan of pull request 1, `docs/superpowers/plans/2026-11-26-passkeys-exist.md`, before starting any task. This plan covers item 2 under "Order of work": every other admin action through `decide`, the lists, the field rule with `passkeyReveals` and the grey bar, the event stream, the app's lists, the remaining 10-minute actions, the cast's unconfirmed members, and `/system`.

**Builds on:** the pull request of `2026-11-26-passkeys-exist.md` (pull request 1), merged or as a branch to stack on. Names marked _(from the passkeys plan)_ come from that plan, not from code: check the real name before you use it, read the "Deviations" at the end of that plan, and keep the behavior asked here. That plan built:

- `Actor.passkeyVerifiedAt` and `Actor.now`.
- `confirmationOf`, `hasAdminRole` and `adminConfirmedUntil`, with the constants `ADMIN_PASSKEY_CONFIRMATION_WINDOW` and `ADMIN_PASSKEY_RECENT_CONFIRMATION_WINDOW` (`apps/api/src/permissions/confirmation.ts`).
- `Decision` `"confirm"` and `requiredConfirmation` in `rules.ts`, with 403 `passkey_required` from `authorize`; `apiErrorCodes.passkeyRequired`.
- `usePasskeyConfirmation`, `requestPasskeyConfirmation`, `backgroundRequestMeta` and `reopenServerEvents` (`packages/api-client`); `PasskeyModal` and the two hosts.
- `MeResponse.adminConfirmedUntil` and `user.hasPasskey`.
- `stampSession`, the soft authenticator, `addPasskey` and `usePasskey` (`apps/api/src/testing/`); `addVirtualAuthenticator` (`e2e/helpers/passkeys.ts`).
- The cast's three admins, stamped at login.

**What the deploy needs:** nothing new: no migration, no secret, no setting. After the deploy every admin's existing session is unconfirmed (pull request 1 started them so). The first admin request asks for the passkey, or to make one. Pull request 1 should be in production a few days before this one, so admins can add a passkey first. That order is the maintainer's to choose.

## What was looked up, and where

Checked on 26 November 2026, in the code on the branch of pull request 1's plan and the pinned packages:

- **Every place that decides by role,** by `grep` over `apps/api/src/routes`: the `authorize` and `decide` calls of `audit-log.ts`, `health.ts`, `membership-requests.ts`, `memberships.ts`, `organizations.ts`, `platform-admins.ts`, `species.ts`, `users.ts` and `working-groups.ts`. Also the lists without a permission: `GET /api/managed-working-groups`, `GET /api/organizations`, `GET /api/membership-requests`, and `GET /api/audit-log-entries` without `organizationId`. They scope by `request.actor` alone. `GET /api/platform-admins` and `POST /api/users/lookup` share their permission (`platform.managePlatformAdmins`, `platform.deleteAccounts`) with actions that need 10 minutes, so this plan splits those two permissions (Task 1).
- **The event stream** (`apps/api/src/routes/events.ts`, `apps/api/src/realtime/audience.ts`): `shouldDeliver(actor, audience, address)` uses `relationTo` and the actor's admin rows. The actor is reloaded at least every `SESSION_RECHECK_MS` (5 minutes).
- **The field rule's two places:** `GET /api/working-groups/{id}/members` decides `workingGroup.viewMemberContact` and passes `contact` to `listMembers`. `GET /api/health` decides `system.viewDatabaseDetails`. `memberSchema` already has `email`, `phone` and `hasLoggedIn` optional.
- **The app's lists** (`packages/api-client/src/membership.ts`, `apps/mobile/src/screens/more/working-group-lists.ts`): `reviewableWorkingGroups` and `memberListWorkingGroups` add every group of an administered organization through `withAdministered`. `useRequestLists` and `useMemberLists` make one query per group. The Meer menu counts requests through `useRequestLists`. `relationToWorkingGroup`, `mayOpenMembers` and `mayRemoveMember` are used by the app and by the portal (`add-members.tsx`, `working-group-page.tsx`).
- **The background rule:** in `@tanstack/query-core` 5.108.2, `Query.observers` is a public array of `QueryObserver` (each with its own `options.meta`), and `Mutation.execute(variables)` is public. The portal's navigation badge and the Werkgroepen page observe the same query (`useManagedWorkingGroups`). So a query's own `meta` cannot tell them apart; its observers can (Task 7).
- **`/system`:** `apps/portal/src/pages/system-page.tsx` and `apps/mobile/src/screens/more/system-screen.tsx` both render `HealthStatus` from `healthQueryOptions()`. The `worker-heartbeat` event has the audience `platform-admins`.
- **The cast and `expectStatuses`** (`apps/api/src/testing/cast.ts`): `expected` is `Record<CastMember | "anonymous", number>` and checks the status only. `cast.organization`'s only admin is `organizationAdmin`, and some tests rely on that. That is a `last_organization_admin` case in `organizations.test.ts`, `users.test.ts` and `delete-me.test.ts` (Task 2).
- **End-to-end:** the portal specs log admins in with `createSession` and act at once. After this pull request each of them needs a confirmed session, and the e2e helpers have no database access yet (`e2e/helpers/admin.ts` runs `pnpm admin`, which the release contains and so must not stamp).
- **`packages/ui`** has no icon library. The eye is an inline SVG.

## Global Constraints

- AGENTS.md applies in full: English code, Dutch UI copy with "je", English kebab-case URL paths, glossary terms, naming per location, generated files never edited by hand.
- Run `pnpm check` before every commit (it includes `check:generated`). After any change to a route or contract run `pnpm api:generate`. Commit the generated files.
- Every new or changed story needs its reference image: run `pnpm screenshots:update` (Docker; never on the host) and commit the images.
- Routes reach the user only through `request.actor` and decide only through `authorize` or `decide`. **A route never compares a window, the roles or `passkeyVerifiedAt` itself**; the rule lives in `decide` alone.
- Answers: 401 without a login; 404 for what the actor may not see at all, also when unconfirmed (an unconfirmed admin never learns more than a confirmed one about another organization); 403 `not_allowed` for what they may see but not change; 403 `passkey_required` where only a confirmation is missing. A list that answers `passkey_required` reads nothing before it does.
- Volunteers, coordinators and applicants without an admin role answer exactly as before this pull request, on every endpoint. Their `expectStatuses` columns do not change.
- No switch (environment variable, header, query parameter) turns the rule off. API tests stamp sessions with `stampSession` _(from the passkeys plan)_; end-to-end tests with `confirmSession` (Task 10), which writes to the dev database directly. Neither is in the release.
- `GET /api/me` keeps reporting every role. The navigation keeps showing the admin pages to an unconfirmed admin.
- A background request (the portal's navigation badge, the app's Meer menu count) never opens the modal.
- The API stays backward compatible: only add fields (`passkeyReveals`). An open old app keeps working and shows the old behavior without bars.
- Fixtures, seed data and test addresses are made up and end in `@example.test`.
- Dutch copy in this plan is exact. Where a small text is missing, write it in the same style.
- Commit after every task with a message in English, ending with the co-author line your session's instructions give. Do not push after every commit.

Dutch texts used in more than one task:

| Code or situation                                   | Text                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| The eye button (`aria-label`)                       | `Toon met je toegangssleutel`                                       |
| A group of an administered organization, not loaded | the group's name, with the grey bar and the eye button under it     |
| The hidden database details on the system status    | `Database` as the label, with the grey bar and the eye button       |
| `passkey_required` (`apiErrorMessage`)              | `Bevestig eerst met je toegangssleutel.` _(from the passkeys plan)_ |

## Review Focus

1. **An admin who is also a coordinator, in the app at night.** An organization admin who coordinates one group opens the app without a passkey session. Their own group's requests and members work as for any coordinator, without a modal. The other groups of the organization show as names with the bar, and nothing asks for a passkey until they press an eye. In the portal, the same person meets the modal once when the first list loads. Pinned in Task 1, Task 5 and Task 9.
2. **The 24 hours run out while a screen is open.** A page stays open past the end of the confirmation, or an event stream outlives it. The next request opens the modal, the stream stops delivering admin events at once, and the app's lists fall back at the moment `adminConfirmedUntil` passes, without a reload. Pinned in Task 4, Task 7 and Task 9.
3. **An unconfirmed admin probes another organization.** They try IDs of organizations, working groups or requests that are not theirs, or ask a list with a filter on another organization. They get the same 404 as before, never `passkey_required`, which would tell that the record exists. A list that asks for a passkey has read nothing. Pinned in Task 1 and Task 3.
4. **A field leaks in the raw JSON.** The unconfirmed admin's member list has no `email`, `phone` or `hasLoggedIn` keys at all, `/api/health` holds no versions, and both carry `passkeyReveals`. A volunteer's answer has neither the keys nor `passkeyReveals`. Pinned in Task 3.
5. **Every existing test and page acts as an admin.** After this pull request each existing admin path asks for a passkey. Every `expectStatuses` table names both unconfirmed admins, every end-to-end test that acts as an admin confirms its session first, and the portal's badge and the Meer menu never open the modal on their own. Pinned in Task 2, Task 7 and Task 10.

---

### Task 1: The rule in `decide`

**Files:**

- Modify: `apps/api/src/permissions/rules.ts`, `apps/api/src/permissions/confirmation.ts` _(from the passkeys plan)_, `apps/api/src/routes/platform-admins.ts`, `apps/api/src/routes/users.ts`, and the API tests that log in an admin outside the cast and expect an admin action to work
- Test: `apps/api/src/permissions/rules.test.ts`, `apps/api/src/permissions/confirmation.test.ts`

**Interfaces:**

- Consumes: `confirmationOf`, `hasAdminRole`, `requiredConfirmation`, `Decision` _(from the passkeys plan)_.
- Produces (`confirmation.ts`): `withoutAdminRoles(actor: Actor): Actor`, the actor with `isPlatformAdmin: false` and `adminOfOrganizationIds: []`, everything else kept. `effectiveActor(actor: Actor): Actor`: the actor itself while `confirmationOf(actor)` is not `none` or the actor has no admin role, else `withoutAdminRoles(actor)`.
- Produces (`rules.ts`):
  - `decideByRoles(actor, permission): "allowed" | "forbidden" | "hidden"`: today's `decide`, renamed and unexported. It holds the role table, untouched.
  - New permissions, split from shared ones so each has one window:

| Action                        | Target | Roles rule                         | Used by                                                 |
| ----------------------------- | ------ | ---------------------------------- | ------------------------------------------------------- |
| `platform.listPlatformAdmins` | none   | as `platform.managePlatformAdmins` | `GET /api/platform-admins` (was `managePlatformAdmins`) |
| `platform.lookUpAccounts`     | none   | as `platform.deleteAccounts`       | `POST /api/users/lookup` (was `deleteAccounts`)         |
| `admin.listAdministered`      | none   | allowed for everyone               | the four scoped lists (Task 3)                          |

- `requiredConfirmation(permission)` _(from the passkeys plan)_ becomes: `recent` for `platform.deleteAccounts`, `platform.managePlatformAdmins`, `organization.manageAdmins`, `platform.manageOrganizations` and pull request 1's `passkeys.removeOwn`, `organization.resetAdminPasskeys`, `platform.resetPlatformAdminPasskeys`, and `passkeys.add` with `hasPasskey`. It is `none` for `passkeys.add` without a passkey. It is `confirmed` for every other action, existing and new. The switch stays exhaustive: a later action gets `confirmed` only by being listed.
- `decide(actor, permission)`, in this order:
  1. `full = decideByRoles(actor, permission)`; anything but `allowed` is returned as it is. That is how an unconfirmed admin keeps today's 404 for other organizations.
  2. `window = requiredConfirmation(permission)`; `none`, or `confirmationOf(actor)` meeting it (`recent` meets both, `confirmed` meets `confirmed`), gives `allowed`.
  3. `admin.listAdministered`: `confirm` when `hasAdminRole(actor)`, else `allowed`. This is the one action where holding an admin role is enough to ask; it is the lists' rule.
  4. Otherwise `decideByRoles(withoutAdminRoles(actor), permission)`: `allowed` gives `allowed` (the admin role was not needed), anything else `confirm`.
- The new rule touches no route: every existing `authorize` and `decide` call gets it.

- [ ] **Step 1: Write the failing tests** (hand-built actors with an injected `now`; for each, a confirmed, a recently confirmed and an unconfirmed copy).

```ts
test("every existing admin action is confirm without a confirmation and allowed with one", ...); // one row per action, a platform admin and an organization admin of the target's organization
test("an organization admin who coordinates the group keeps reviewRequests, viewMemberContact, addMembers and removeMember of a volunteer without a confirmation", ...);
test("an organization admin who is a volunteer of the group: listMembers allowed, viewMemberContact confirm", ...);
test("an organization admin of another organization stays hidden, confirmed or not", ...);
test("a platform admin who is a member of nothing: every working group action is confirm unconfirmed", ...);
test.each(["platform.deleteAccounts", "platform.managePlatformAdmins", "organization.manageAdmins", "platform.manageOrganizations"])("%s needs the 10 minutes: confirm at 11 minutes, allowed at 9", ...);
test("platform.listPlatformAdmins and platform.lookUpAccounts need 24 hours, not 10 minutes", ...);
test("admin.listAdministered: allowed for a coordinator and a volunteer, confirm for an unconfirmed admin who also coordinates", ...);
test("a volunteer, a coordinator and an applicant decide exactly as decideByRoles, whatever their session", ...);
test("the windows at their edges: 24 h minus 1 ms allowed, 24 h confirm; 10 min minus 1 ms allowed, 10 min confirm", ...);
test("effectiveActor drops the admin roles only of an unconfirmed admin", ...);
```

- [ ] **Step 2: Run them.** `pnpm vitest run apps/api/src/permissions`. Expected: FAIL.
- [ ] **Step 3: Implement.** Change `GET /api/platform-admins` and `POST /api/users/lookup` to the two new actions in the same commit. Every API test that logs in an admin outside the cast (with `loginAs` and an administration function) and expects an admin action to work now calls `stampSession` _(from the passkeys plan)_ with the current time; the cast's own admins are stamped already.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS: the existing tables still hold, because the cast's admins are confirmed.
- [ ] **Step 5: Commit.** `git commit -m "Ask for a passkey for every decision that needs an admin role"`

---

### Task 2: The cast's unconfirmed admins, and every `expectStatuses` table

**Files:**

- Modify: `apps/api/src/testing/cast.ts`, `apps/api/src/testing/cast.test.ts`, every API test with `expectStatuses` (`users`, `working-groups`, `organizations`, `platform-admins`, `delete-me`, `managed-working-groups`, `members`, `species`, `add-members`, `membership-requests`, `audit-log`, `membership-requests-review`, `passkeys` _(from the passkeys plan)_)
- Test: the same files

**Interfaces:**

- Produces (`cast.ts`):
  - `CastMember` gains `platformAdminUnconfirmed` (a second platform admin, no membership) and `organizationAdminUnconfirmed` (a second admin of `cast.organization`, and a volunteer of `cast.workingGroup`). Neither is stamped.
  - The comments change: `cast.organization` has two admins. Tests that need `organizationAdmin` to be the only admin of an organization (the `last_organization_admin` cases) make their own organization, as `users.test.ts` already does with its helper.
  - `expectStatuses(cast, expected, send)`: `expected` values are `number | "passkey_required"`. `"passkey_required"` means 403 with that `code` in the body. `send` returns the inject response, so the body can be read. A plain `403` now also checks that the code is **not** `passkey_required`, so the two are never confused.
- Every table names both new members (a type error until it does).

- [ ] **Step 1: Write the failing tests** (`cast.test.ts`).

```ts
test("the cast's unconfirmed admins have no passkey moment; the other admins are recently confirmed", ...);
test("organizationAdminUnconfirmed is an admin of cast.organization and a volunteer of cast.workingGroup", ...);
test("expectStatuses tells 403 not_allowed from 403 passkey_required", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then add the two members to every table. The values, for the existing endpoints:
  - `platformAdminUnconfirmed`: `"passkey_required"` wherever `platformAdmin` gets a success, except `GET /api/health` (200) and the endpoints every logged-in user may use (`GET /api/species`, `GET /api/working-groups`, `GET /api/me` and the like: as a volunteer gets them).
  - `organizationAdminUnconfirmed`: as `organizationAdmin` gets it where `organizationAdmin` gets 404 or 403 `not_allowed`. As `volunteer` gets it on `cast.workingGroup` where a volunteer's answer is a success (`listMembers`: 200). `"passkey_required"` wherever `organizationAdmin` gets a success only because of the admin role, and on the four scoped lists (Task 3).
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the unconfirmed admins to the cast and to every permission table"`

---

### Task 3: The lists, and the field rule with `passkeyReveals`

**Files:**

- Modify: `apps/api/src/routes/working-groups.ts`, `apps/api/src/routes/organizations.ts`, `apps/api/src/routes/membership-requests.ts`, `apps/api/src/routes/audit-log.ts`, `apps/api/src/routes/health.ts`, `packages/contracts/src/members.ts`, `packages/contracts/src/health.ts`, their fixtures
- Create (generated): the OpenAPI file and client
- Test: `apps/api/src/routes/managed-working-groups.test.ts`, `organizations.test.ts`, `membership-requests-review.test.ts`, `audit-log.test.ts`, `platform-admins.test.ts`, `users.test.ts`, `members.test.ts`, `health.test.ts`

**Interfaces:**

- Consumes: Task 1's `admin.listAdministered`, `platform.listPlatformAdmins`, `platform.lookUpAccounts`.
- Produces (routes):
  - `GET /api/managed-working-groups`, `GET /api/organizations`, `GET /api/membership-requests` and `GET /api/audit-log-entries` (with or without `organizationId`) call `authorize(actor, { action: "admin.listAdministered" })` as their first statement. `GET /api/organizations/{id}`, `GET /api/platform-admins` and `POST /api/users/lookup` get theirs through their own permission (Task 1), and decide before reading too. Each lists `403` in `errorResponses`.
  - `GET /api/audit-log-entries?organizationId=…` keeps its order of answers: `admin.listAdministered` first, then `organization.readAuditLog`. An unconfirmed admin gets `passkey_required` without learning whether the organization exists.
  - The field rule, one helper in `apps/api/src/permissions/fields.ts`: `fieldAccess(decision: Decision): { include: boolean; reveal: boolean }` gives `allowed` → include; `confirm` → reveal; anything else → neither. It is never a 403.
  - `GET /api/working-groups/{id}/members`: with `reveal`, every member is listed without the keys `email`, `phone` and `hasLoggedIn`, and the response has `passkeyReveals: ["email", "phone", "hasLoggedIn"]`. Otherwise the key is absent.
  - `GET /api/health`: with `reveal` (an unconfirmed platform admin, the database reachable) the details stay hidden as for anyone, plus `passkeyReveals: ["database"]`. It never answers `passkey_required`.
- Produces (contracts): `memberListResponseSchema.passkeyReveals: z.array(z.enum(["email", "phone", "hasLoggedIn"])).optional()`; `healthResponseSchema.passkeyReveals: z.array(z.literal("database")).optional()`. A later field that depends on a role adds its name to its response's enum the same way.

- [ ] **Step 1: Write the failing tests.**

```ts
test.each(["/api/managed-working-groups", "/api/organizations", "/api/membership-requests", "/api/audit-log-entries", "/api/platform-admins"])("%s is passkey_required for an unconfirmed admin and reads nothing", async (path) => {
  // a spy on ctx.t.pool.query after the actor is loaded: no query runs between the actor and the answer
});
test("POST /api/users/lookup is passkey_required for an unconfirmed platform admin, and the address is not looked up", ...);
test("an unconfirmed organization admin who coordinates a group gets passkey_required on GET /api/membership-requests, and its own group's list through GET /api/working-groups/{id}/membership-requests", ...);
test("an unconfirmed admin asking the log of another organization gets 404, not passkey_required", ...);
test("an unconfirmed organization admin who is a volunteer gets the members without email, phone and hasLoggedIn keys, with passkeyReveals, and no passkey_required", ...); // raw JSON
test("a confirmed admin gets the keys and no passkeyReveals", ...);
test("a volunteer who is no admin gets neither the keys nor passkeyReveals", ...);
test("an unconfirmed organization admin who is no member of the group gets passkey_required on its members", ...);
test("/api/health: an unconfirmed platform admin gets detailsHidden, null versions and passkeyReveals ['database']; a confirmed one the details; anonymous neither", ...);
test("/api/health with the database unreachable has no passkeyReveals", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Ask for a passkey before admin lists, and say which fields a passkey reveals"`

---

### Task 4: The event stream by effective roles

**Files:**

- Modify: `apps/api/src/routes/events.ts`, `apps/api/src/realtime/audience.ts`
- Test: `apps/api/src/realtime/audience.test.ts`, `apps/api/src/routes/events.test.ts`

**Interfaces:**

- Consumes: Task 1's `effectiveActor`.
- Produces: the stream decides each delivery with `shouldDeliver(effectiveActor({ ...actor, now: new Date() }), audience, address)`. The roles come from the actor loaded at most 5 minutes ago, as today; the moment is that of the delivery. So a confirmation that runs out stops admin events at once, not at the next reload. `shouldDeliver` itself does not change; it gets the effective actor.

- [ ] **Step 1: Write the failing tests.**

```ts
test("an unconfirmed organization admin does not receive membership-requests-changed for a group they do not coordinate", ...);
test("the same admin receives it for the group they coordinate", ...);
test("a confirmed organization admin receives it for every group of the organization", ...);
test("an unconfirmed platform admin receives no worker-heartbeat and no event of another organization", ...);
test("a confirmation that runs out while the stream is open stops the admin events without a reconnect", ...); // stamp 24 h minus 1 s ago, wait, send
test("events for the user (access-changed) still reach an unconfirmed admin", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Deliver live events by the roles a session has without a passkey"`

---

### Task 5: `packages/api-client`: the app's lists follow the confirmation

**Files:**

- Modify: `packages/api-client/src/membership.ts`, `apps/mobile/src/screens/more/working-group-lists.ts`
- Test: `packages/api-client/src/membership.test.tsx`, `apps/mobile/src/screens/more/working-group-lists.test.tsx` (create if missing)

**Interfaces:**

- Consumes: `MeResponse.adminConfirmedUntil` _(from the passkeys plan)_.
- Produces (`membership.ts`):
  - `isAdminConfirmed(me: MeResponse, now: Date): boolean`: `adminConfirmedUntil` is set and later than `now`.
  - `splitByConfirmation(me: MeResponse, groups: WorkingGroupSummary[], now: Date): { loaded: WorkingGroupSummary[]; hidden: WorkingGroupSummary[] }`. A group is `hidden` when it is in the list only through an organization admin role (the user is no member of it) and `isAdminConfirmed` is false. Every other group is `loaded`. The order is kept.
  - `reviewableWorkingGroups` and `memberListWorkingGroups` keep their meaning (every group by full roles), so the Meer menu keeps showing its items to an unconfirmed admin.
  - `relationToWorkingGroup`, `mayOpenMembers` and `mayRemoveMember` take an optional last argument `{ now: Date }`. With it, an admin relation counts only while `isAdminConfirmed`; otherwise the relation is the one of the membership. The app passes it; the portal does not, because it asks for the passkey when a button is pressed.
- Produces (`working-group-lists.ts`): `useRequestLists(me)` and `useMemberLists(me)` query only the `loaded` groups and return `hiddenGroups: WorkingGroupSummary[]` beside `groups`. The Meer menu's count sums the loaded lists only, and its queries carry `backgroundRequestMeta` _(from the passkeys plan)_.

- [ ] **Step 1: Write the failing tests.**

```ts
test("splitByConfirmation: an unconfirmed organization admin who coordinates Noord loads Noord and hides Zuid", ...);
test("a confirmed admin loads all; a coordinator without an admin role has nothing hidden", ...);
test("at adminConfirmedUntil exactly the admin's groups are hidden", ...);
test("mayOpenMembers with now: a volunteer-admin unconfirmed cannot open, confirmed can; without now as before", ...);
test("useRequestLists asks no list for a hidden group and returns it in hiddenGroups", ...);
test("the Meer menu's count leaves out hidden groups and never opens the modal", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Load the groups of an administered organization in the app only while confirmed"`

---

### Task 6: `packages/ui`: the grey bar with the eye, and where it shows

**Files:**

- Create: `packages/ui/src/components/passkeys/passkey-hidden.tsx`, `passkey-hidden.stories.tsx`
- Modify: `packages/ui/src/components/members/member-list.tsx`, `member-detail.tsx`, `packages/ui/src/components/joining/membership-request-list.tsx`, `packages/ui/src/components/administration/members-table.tsx`, `packages/ui/src/components/health-status.tsx`, their stories, `packages/ui/src/index.ts`
- Create (generated): reference images
- Test: next to each component

**Interfaces:**

- Produces:
  - `PasskeyHidden(props: { onReveal(): void; width?: "short" | "long" })`: a grey bar (`bg-muted`, rounded, the height of a line of text, `aria-hidden`), and next to it a button with an eye icon (inline SVG, at least 44×44 px). The button has `aria-label` `Toon met je toegangssleutel` and calls `onReveal`. Story: Default, and one in a `DetailRow`.
  - `MemberList` gains `hiddenGroups?: WorkingGroupSummary[]` and `onReveal?()`: each hidden group shows its name as a heading with `PasskeyHidden` under it, after the loaded groups. It also gains `revealable?(workingGroupId): boolean`: rows of a group whose list carries `passkeyReveals` open, so the detail can show the bar. `MembershipRequestList` gains the same `hiddenGroups` and `onReveal`.
  - `MemberDetail` gains `onReveal?()`: when `onReveal` is given and the member has no `email`, the address and phone rows show `PasskeyHidden` in place of their values.
  - `MembersTable` (portal) gains `onReveal?()`: without `email` on the rows and with `onReveal`, the address and phone cells show `PasskeyHidden`.
  - `HealthStatus` gains `onReveal?()`: when `health.passkeyReveals` holds `database`, a row `Database` shows `PasskeyHidden` in place of the versions and the latest migration.
  - Stories: MemberList WithHiddenGroups, MemberDetail Hidden, MembershipRequestList WithHiddenGroups, MembersTable Hidden (1024×768), HealthStatus Hidden.

- [ ] **Step 1: Write the failing tests.**

```tsx
test("the eye button has the aria-label Toon met je toegangssleutel and calls onReveal", ...);
test("a hidden group shows its name and the bar, and no member or request", ...);
test("the member detail shows the bar in place of the address and the phone number", ...);
test("the members table shows the bar in the contact cells", ...);
test("the health status shows the bar for the database details only with passkeyReveals", ...);
test("without onReveal nothing changes", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm screenshots:update && pnpm test:visual:docker`. Expected: PASS, with new reference images to commit.
- [ ] **Step 5: Commit.** `git commit -m "Show what a passkey would reveal as a grey bar with an eye button"`

---

### Task 7: The confirmation hook after pull request 1

**Files:**

- Modify: `packages/api-client/src/passkey-confirmation.ts` _(from the passkeys plan)_, `packages/api-client/src/administration.ts`
- Test: `packages/api-client/src/passkey-confirmation.test.tsx`

**Interfaces:**

- Changes to pull request 1's hook:
  - **Which requests are background.** A failed query opens the modal when at least one of its observers lacks `backgroundRequestMeta` in its own options (`query.observers[i].options.meta`). The portal's badge and the Werkgroepen page observe one query; only the page should ask. A mutation counts by its own `meta`, as before.
  - **After a confirmation** the hook invalidates every query (`queryClient.invalidateQueries()`, which refetches the active ones). It still runs the reported mutations again and reopens the event stream. The session changed, and the eye button has no failed request to refetch.
  - **When the confirmation runs out.** `useAdminConfirmationExpiry()`, mounted by both hosts, sets one timer for `adminConfirmedUntil` and refetches me when it passes. The app's lists then fall back without a reload.
- `useManagedWorkingGroups` gets an option `{ background?: boolean }`. The portal's badge passes `true`, the pages do not.

- [ ] **Step 1: Write the failing tests.**

```tsx
test("a query observed by a background badge and by a page opens the modal", ...);
test("a query observed only by the badge does not open the modal", ...);
test("after a confirmation every active query refetches, also one that never failed", ...);
test("requestPasskeyConfirmation from an eye button, then confirm: the screen's queries refetch", ...);
test("me is refetched when adminConfirmedUntil passes", ...); // fake timers
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Refetch everything after a confirmation, and leave background requests alone"`

---

### Task 8: Portal: the modal at work, the bars, `/system`

**Files:**

- Modify: `apps/portal/src/layout/portal-layout.tsx`, `apps/portal/src/pages/working-group-page.tsx`, `apps/portal/src/pages/system-page.tsx`, the pages whose dialogs close in a `mutate` callback (`organization-page.tsx`, `organizations-page.tsx`, `working-groups-page.tsx`, `working-group-page.tsx`, `add-members.tsx`, `species-page.tsx`, `platform-admins-page.tsx`, `delete-account-page.tsx`, `membership-requests-page.tsx`)
- Test: the tests next to those pages, `apps/portal/src/layout/portal-layout.test.tsx`

**Interfaces:**

- Consumes: Tasks 6 and 7; `requestPasskeyConfirmation` _(from the passkeys plan)_.
- Produces:
  - The navigation badge's query is background (Task 7).
  - The members table on `/working-groups/{id}` gets `onReveal` (it opens the modal); after the confirmation the table loads again with the contact details.
  - `/system`: `HealthStatus` with `onReveal`.
  - Every dialog that submits a mutation which can answer `passkey_required` closes and shows its toast on the mutation's success state, not in a `mutate` callback. Then the resend after a confirmation closes it too (as pull request 1 did for the reset dialog). An `Annuleer` in the modal leaves the dialog open with `Bevestig eerst met je toegangssleutel.`
  - Opening the portal as an unconfirmed admin lands on Werkgroepen. Its list asks for the passkey (the modal), and after the confirmation the page shows.

- [ ] **Step 1: Write the failing tests** (`renderPortal`, `mockFetch`; the ceremony mocked).

```tsx
test("an unconfirmed admin opening Werkgroepen sees the modal once; after confirming, the list", ...);
test("on another page, a passkey_required of the badge does not open the modal and the badge shows no number", ...);
test("a member list with passkeyReveals shows the bars; the eye confirms and the addresses show", ...);
test("/system shows the bar for an unconfirmed platform admin; the eye confirms and the versions show", ...);
test("appointing a platform admin after a confirmation closes the dialog with its toast", ...);
test("Annuleer in the modal leaves the species dialog open with Bevestig eerst met je toegangssleutel.", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and look.** `pnpm check && pnpm build`. Then `pnpm dev`, log in on the portal as `beheerder@example.test` with a code, in Chrome with a virtual authenticator. Confirm at Werkgroepen, then open a group. Save screenshots to `.context/portal-confirm-modal.png` and `.context/portal-hidden-contact.png` (the latter after `UPDATE sessions SET passkey_verified_at = null` in the dev database).
- [ ] **Step 5: Commit.** `git commit -m "Ask for the passkey in the portal where admin power is used, and show what it hides"`

---

### Task 9: The app: lists, member detail, request by address, system status

**Files:**

- Modify: `apps/mobile/src/screens/more/membership-requests-screen.tsx`, `members-screen.tsx`, `member-screen.tsx`, `membership-request-screen.tsx`, `system-screen.tsx`, `more-menu.tsx`
- Test: the tests next to them

**Interfaces:**

- Consumes: Tasks 5, 6 and 7.
- Produces:
  - The requests and members screens pass `hiddenGroups` and `onReveal` (`requestPasskeyConfirmation`). After the confirmation the hidden groups load and show as the others.
  - `mayOpenMembers` and `mayRemoveMember` get `{ now: new Date() }`. A group whose member list carries `passkeyReveals` lets its rows open. The member screen passes `onReveal` to `MemberDetail` when the list carries `passkeyReveals`.
  - A request opened by its address (`/more/membership-requests/{id}`, the link in a mail) is a screen the person opened. When it answers `passkey_required`, the modal shows, and after the confirmation the request shows.
  - The system screen passes `onReveal` to `HealthStatus`.
  - The Meer menu shows `Aanmeldingen` and `Leden` by full roles, as before, and counts loaded lists only.

- [ ] **Step 1: Write the failing tests.**

```tsx
test("an unconfirmed admin who coordinates Noord sees Noord's requests without a modal, and Zuid as a name with the bar", ...);
test("the eye confirms and Zuid's requests show", ...);
test("the members screen of a volunteer-admin opens a member, whose detail shows the bars", ...);
test("a request of an administered group opened by its address shows the modal, then the request", ...);
test("the system screen shows the bar for an unconfirmed platform admin", ...);
test("a volunteer and a coordinator without an admin role see no bar and no modal anywhere", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Let the app fall back without a passkey, and show what a passkey reveals"`

---

### Task 10: End-to-end tests and the documentation

**Files:**

- Create: `e2e/helpers/database.ts`, `e2e/portal-admin-power.spec.ts`
- Modify: every portal spec that acts as an admin (`portal-administration`, `portal-adding-people`, `portal-membership-requests`, `portal-audit-log-and-accounts`, `portal-species`, `portal-passkeys` _(from the passkeys plan)_ where needed), `e2e/mobile-system-status.spec.ts`, `package.json` (root devDependency `pg`, the same range as the apps), `pnpm-lock.yaml`, `AGENTS.md`, `scripts/lib/ci-jobs.ts` and its test (only if needed)

**Interfaces:**

- Produces (`e2e/helpers/database.ts`): `confirmSession(context: BrowserContext): Promise<void>`. It reads the session cookie of the context (`padvinder.session_token`; the token is the part before the first `.` of the decoded value). It sets `passkey_verified_at = now()` on that session in the dev database (`DATABASE_URL`, as the dev server uses it), with one parameterized `update`. It is a test helper only: the release has no way to do this. Every existing end-to-end test that acts as an admin calls it right after `createSession`. The tests about passkeys use the real flow with `addVirtualAuthenticator` _(from the passkeys plan)_.

- [ ] **Step 1: Write the tests.**

```ts
test("an organization admin logs in with a code, opens Werkgroepen, makes a passkey in the modal and sees the page", async ({
  page,
}) => {
  // createWorkingGroup(); its adminAddress logs in on the portal's login screen with a code (readLoginCode);
  // a virtual authenticator; Werkgroepen: the modal "Maak een toegangssleutel"; press it: the groups show.
});
test("a platform admin deletes an account after confirming again", async ({ page }) => {
  // A platform admin (runAdmin) with a passkey made in the modal; the session stamped 11 minutes ago in the database
  // (an UPDATE through the helper's connection). Account verwijderen: the lookup works (within 24 h);
  // Verwijder account opens the modal "Bevestig dat jij het bent"; after it the account is deleted and the toast shows.
});
test("an unconfirmed organization admin who coordinates a group uses it in the app without a modal", async ({
  browser,
}) => {
  // The app (phone context): Meer, Aanmeldingen: the own group's request shows; the other group shows its name with
  // the eye button; no dialog until it is pressed.
});
// the existing portal specs and mobile-system-status.spec.ts: confirmSession(context) after createSession for every admin
```

- [ ] **Step 2: Run.** `pnpm test:e2e` three times. Expected: PASS each time.
- [ ] **Step 3: Update `AGENTS.md`.**
  - Current state: admin power needs a passkey (this pull request).
  - Roles and permissions: the rule in `decide` (decided again without the admin roles; coordinator-and-admin keeps their group; 404 stays 404), `requiredConfirmation` with the 10-minute actions and the rule that a new action is listed there, `admin.listAdministered` for lists whose scope grows through admin roles, the split permissions `platform.listPlatformAdmins` and `platform.lookUpAccounts`, `effectiveActor`, and that a route never reads a window.
  - API and versioning: the field rule (`fieldAccess`, `passkeyReveals`, never a 403) with the two current cases, and that a later role-dependent field follows it.
  - The reference example's realtime notes: the stream delivers by `effectiveActor` at the moment of delivery.
  - Frontend: the app's lists and `splitByConfirmation`, `PasskeyHidden`, background requests by observer, dialogs that close on the mutation's state.
  - Tests: the cast's unconfirmed members, `expectStatuses` with `"passkey_required"`, and `confirmSession` in end-to-end tests that act as an admin.
- [ ] **Step 4: Check the CI rules** (AGENTS.md, "CI"), then run everything: `pnpm check && pnpm build && pnpm test:e2e && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add end-to-end tests for admin power with passkeys, and document the rule"`

## Decisions made while planning

The spec leaves these open, or this plan departs from it. The maintainer may overrule each; the task that holds it is named.

1. **An organization admin who is no member of a group gets `passkey_required` on its member list,** not the list without contact details. The design's field rule mentions this case ("or no member of it"), but its rule in `decide` makes `workingGroup.listMembers` need the admin role there, and so `confirm`. The plan follows the rule; the field rule then applies to an admin who is a member (Task 1 and Task 3). **Question for the orchestration session.**
2. **The lists' rule is its own permission, `admin.listAdministered`,** decided in `decide`. "Answer `passkey_required` to anyone with an admin role who is unconfirmed" does not follow from "allowed only because of an admin relation": without the admin roles a coordinator's list is still allowed. One place still holds it, and no route reads a window (Task 1). **Question for the orchestration session.**
3. **`platform.managePlatformAdmins` and `platform.deleteAccounts` are split** into a 24-hour action for reading (`platform.listPlatformAdmins`, `platform.lookUpAccounts`) and the 10-minute one for the change (Task 1).
4. **The event stream uses the moment of delivery,** so a confirmation that runs out stops admin events at once, stricter than the design's "within 5 minutes" (Task 4).
5. **An unconfirmed platform admin gets no `worker-heartbeat`:** the event's audience is platform admins, and they are not one in effect. `/system` then updates on reload or after a confirmation (Task 4).
6. **A request counts as background by its observers,** not by its own `meta` as pull request 1 planned. One query can be both the badge and a page (Task 7).
7. **After a confirmation every active query refetches,** not only the ones that failed. The session is new, and the eye button has no failed request (Task 7).
8. **The app's Meer menu shows its items by full roles** and counts only what it loaded, so an unconfirmed admin can still reach the bars (Tasks 5 and 9).
9. **In the app, the rows of a group whose list carries `passkeyReveals` open,** so the member detail can show the bar; otherwise a volunteer-admin would see the plain list and nothing that says more exists (Task 9).
10. **The cast's `organizationAdminUnconfirmed` is a second admin of `cast.organization` and a volunteer of `cast.workingGroup`.** That way the tables show the confirmed and unconfirmed admin on the same targets, and the field rule shows up in `listMembers`. Tests that need a single admin make their own organization (Task 2).
11. **`expectStatuses` tells `passkey_required` from `not_allowed`** by the body's code (Task 2).
12. **End-to-end tests confirm a session through the dev database** (`confirmSession`, with `pg` as a root devDependency). The tests about passkeys use the virtual authenticator (Task 10).
13. **Dialogs close on the mutation's state** on every portal page that can meet `passkey_required`, so a resend after a confirmation finishes them (Task 8).

## Deviations

Recorded while building, 26 November 2026.

- Task 2: `PATCH /api/organizations/{id}` authorizes `organization.rename` before `organization.changeContact` when the body has `name`, so an unconfirmed organization admin who may not rename gets 403 `not_allowed`, not a passkey prompt followed by a 403 (passkey_required only where a confirmation is the only thing missing).
- Task 2: tests that needed `organizationAdmin` as the only admin of an organization remove the second admins for that test or make their own organization; the delete-me table relies on the cast's member order (first admins get 204, their unconfirmed twins then 409 as the last ones).
- Task 3: `GET /api/audit-log-entries?organizationId=` decides `organization.readAuditLog` first, then `admin.listAdministered` (the plan said the other order), so an unconfirmed admin gets the same 404 for another organization as before and `passkey_required` for their own; `organizationRelationTo` reads only the actor, so nothing is read before either answer.
- Task 3: "reads nothing" is pinned by `recordQueries` (`apps/api/src/testing/query-log.ts`), which compares a list request's SQL with that of a request `authorize` refuses at once. The members list reads the working group row before deciding, to find its target; an outsider gets the same 404.
- Task 5: `splitByConfirmation(me, groups, now, through)` takes a fourth argument, `"membership"` (members) or `"coordination"` (requests): reviewing needs the admin role, so a volunteer-admin's own group's requests are hidden while unconfirmed. `useRequestLists` and `useMemberLists` take `{ background }`; only the Meer menu passes it. `useMemberLists` returns each group's `reveals`.
- Task 7: settles pull request 1's open point. Live-event, stream-reopen and mutation refetches skip queries that wait for a passkey (`waitsForPasskey`: idle with a `passkey_required` error), as window focus did, so Annuleer leaves the page with its error and a live event does not reopen the modal; a page that mounts again asks again. A query with no observers never opens the modal. When `adminConfirmedUntil` moves later (a confirmation in another tab) the waiting queries refetch. `useAdminConfirmationExpiry` checks again every minute when the device clock is ahead of the server's.
- Task 8: besides the dialogs listed, `create-working-group.tsx` closes on the mutation's state; `useRemovePlatformAdmin({ onRemoved })`, and `useUpdateWorkingGroup`, `useUpdateSpecies`, `useSetCoordinator` with `{ onSuccess }`, give the toasts of a resend (also for removing oneself, whose page unmounts). The screenshots of step 4 were not made; the end-to-end tests cover the flow.
- Task 10: `confirmSession(context, { minutesAgo })` takes an option for the second test, which needs a confirmation 11 minutes old.
- Task 10: `e2e/portal-passkeys.spec.ts` changed too: an admin on a code session now meets the passkey modal on Werkgroepen, the first page home goes to, so the tests make or use the passkey there and open `/profile/passkeys` directly.
