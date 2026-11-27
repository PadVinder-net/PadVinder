# Passkeys Exist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pull request 1 of "A stronger login for admins: passkeys": admins add, use and remove passkeys, log in to the portal with one, and repair a colleague who lost theirs; a session remembers when a passkey was last used for it. Every other admin action keeps working as today.

**Architecture:** Better Auth's passkey package runs behind four new allowlisted routes. Our Fastify routes in front of them check who may add a passkey (through `decide`), force a new session on every passkey ceremony, delete the session it replaces, and answer only `{ ok: true }` to the verify calls. A database hook stamps `sessions.passkey_verified_at` on every session such a ceremony makes. The actor carries that moment and the time of the request, and `decide` gets a fourth outcome, `confirm`, which `authorize` answers as 403 `passkey_required`. In this pull request only the passkey endpoints ask for it. In both apps one shared modal, driven by one hook in `packages/api-client`, asks for the passkey when a request answers `passkey_required`.

**Tech Stack:** The existing stack, plus `@better-auth/passkey` 1.7.27 (API), `@simplewebauthn/browser` 13.3.0 (api-client, mobile, portal) and `@simplewebauthn/server` 13.3.3 (API, dev only, for the software authenticator in tests). All three are pinned exactly.

**Spec:** `docs/superpowers/specs/2026-11-26-passkeys-for-admins-design.md`. Read it, and `AGENTS.md`, before starting any task. This plan covers item 1 under "Order of work". It covers the table and the column, the package and its four routes, the guards and the stamping, the windows on the actor, `decide`'s new outcome and `passkey_required`, the modal and its hook, and the passkey endpoints with their own windows. It also covers `hasPasskey` and the two me fields, the passkeys screen with its buttons on both profiles, the portal's profile page, the login button, repairing someone else, the audit entries, the mails and the emergency procedure. Item 2 ("Admin power needs them") is a later plan.

**What the deploy needs:** one migration (a new table `passkeys`, a new nullable column `sessions.passkey_verified_at`). There is no new secret and no new setting. The relying party ID is the host name of `PUBLIC_ORIGIN`, and the allowed origins are `ALLOWED_ORIGINS`; both are set already. Moving PadVinder to another domain later makes every passkey useless. Admins then log in with a code and add a new one, after another admin resets theirs (Task 12 writes this into `infra/alwaysdata/README.md`).

## What was looked up, and where

Checked on 26 November 2026, against the pinned versions:

- **The package exists and matches.** `npm view @better-auth/passkey@1.7.27`: published 20 November 2026, 1 minute after `better-auth@1.7.27`. Its peers (`better-auth ^1.7.27`, `@better-auth/core ^1.7.27`, `better-call ~1.4.5`, `@better-auth/utils`, `@better-fetch/fetch 1.3.3`, `nanostores`) are already in `pnpm-lock.yaml` at matching versions. It depends on `@simplewebauthn/server ^13.3.2` (resolves to 13.3.3, published 26 August 2026) and `@simplewebauthn/browser ^13.3.0` (13.3.0, March 2026). pnpm 12.21's default `minimumReleaseAge` is 1440 minutes (read from its `dist`), and the repository sets no other. All three packages are older than that, so **no `minimumReleaseAgeExclude` entry is needed**.
- **Routes** (from the package's `dist/index.mjs`): `GET /passkey/generate-register-options` (middleware `sensitiveSessionMiddleware` and `freshSessionMiddleware`; query `authenticatorAttachment`, `name`, `context`; answers the WebAuthn creation options, including `excludeCredentials` with the account's own credential IDs; sets the signed cookie `<prefix>.better-auth-passkey` for 300 s and stores the challenge in `verifications`). `GET /passkey/generate-authenticate-options` (no middleware; with a session it fills `allowCredentials` with that account's passkeys only when it has any, otherwise none, for a discoverable login). `POST /passkey/verify-registration` (body `{ response, name?, createSession? }`, same middleware; answers the passkey row, with `publicKey` and `credentialID`, and with `createSession: true` also `session` with its `token` and `user`; it does not delete the old session). `POST /passkey/verify-authentication` (body `{ response }`; finds the passkey by `response.id`, verifies, runs the option `authentication.afterVerification`, updates the counter, makes a session for the passkey's user and answers `{ session, user }`; it never compares that user with the cookie's session and leaves the old session in place). Also `GET /passkey/list-user-passkeys`, `POST /passkey/delete-passkey`, `POST /passkey/update-passkey`, which stay unmounted.
- **Schema:** model `passkey` with `name` (string, optional), `publicKey`, `userId` (references `user.id`, index), `credentialID` (index), `counter` (number), `deviceType`, `backedUp` (boolean), `transports` (optional), `createdAt` (date, optional; the plugin sets it), `aaguid` (optional). The Drizzle adapter maps a model to the table object passed as `schema.passkey`, by JavaScript key, so the table is `passkeys` with snake_case columns and keys exactly as above (`credentialID` included).
- **`freshSessionMiddleware`** (`better-auth/dist/api/routes/session.mjs`) compares `session.createdAt`, not `updatedAt`, with `session.freshAge`, and answers 403 `SESSION_NOT_FRESH`. `freshAge` defaults to 86400 seconds (`dist/context/create-context.mjs`). Our daily renewal therefore does not make a session fresh again, as the design wants.
- **`databaseHooks.session.create.before`** is called as `before(data, context)`, where `context` is `tryGetCurrentAuthEndpointContext()`: the endpoint context, with `path`, also for the session that `verify-registration` makes inside its transaction (`dist/db/with-hooks.mjs`). So the design's stamping works as assumed.
- **Relying party ID and origin:** the package uses `options.rpID`, else the host name of `baseURL`. With `options.origin` set, it passes exactly that list to SimpleWebAuthn as `expectedOrigin`. `authenticatorSelection` is spread into the creation options, and its `userVerification` is also used for authentication and for `requireUserVerification` at both verifications. Attestation is always `"none"`.
- **Log lines:** on a failed verification the package logs SimpleWebAuthn's error through Better Auth's logger. Those messages quote the challenge and the origin (`Unexpected authentication response challenge "…", expected "…"`, in `@simplewebauthn/server` 13.3.3). Our `forwardLog` keeps an error's message, so it must scrub quoted values (Task 6).
- **Rate limits:** Better Auth's stricter default rule matches only `/sign-in`, `/sign-up`, `/change-password` and `/change-email`. Without our own `customRules` the four passkey paths would get the global default.
- **Browser side:** `@simplewebauthn/browser` 13.3.0 exports `startRegistration({ optionsJSON })`, `startAuthentication({ optionsJSON })` and `browserSupportsWebAuthn()`. Its errors are `WebAuthnError` with a `code` (such as `ERROR_CEREMONY_ABORTED`, `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED`) or the browser's own `NotAllowedError`. The package's own browser client calls the `generate-*` routes with `GET`, which we do not mount, so the apps call the routes through our own small client instead (Task 8).
- **A software authenticator for Vitest:** no new dependency. `@simplewebauthn/server/helpers` exports `isoCBOR` and `isoBase64URL`, which with `node:crypto` (P-256, ES256) make the attestation object and the assertion (Task 6).
- **Chromium's virtual authenticator:** the Chrome DevTools Protocol's `WebAuthn` domain (`WebAuthn.enable`, `WebAuthn.addVirtualAuthenticator` with `protocol: "ctap2"`, `transport: "internal"`, `hasResidentKey`, `hasUserVerification`, `isUserVerified`, `automaticPresenceSimulation`), reached through Playwright's `browserContext.newCDPSession(page)`. Both exist in the pinned Playwright 1.65.1 and its Chromium. WebAuthn works on `http://localhost` (a secure context), and both dev origins are on `localhost`, the relying party ID there. It does not work under `pnpm dev:https` from a phone on a LAN IP address: an IP address cannot be a relying party ID (Task 12 documents this).

## Global Constraints

- AGENTS.md applies in full: English code, Dutch UI copy with "je", English kebab-case URL paths, glossary terms, naming per location, generated files never edited by hand.
- Run `pnpm check` before every commit (it includes `check:generated`). After any change to a route or contract run `pnpm api:generate`; after any schema change run `pnpm db:generate`. Commit the generated files.
- Every new or changed story needs its reference image: run `pnpm screenshots:update` (Docker; never on the host) and commit the images. A portal component's story sets `visualViewport` (1024×768).
- New exact dependencies: `@better-auth/passkey` `1.7.27` (apps/api `dependencies`); `@simplewebauthn/browser` `13.3.0` (packages/api-client, apps/mobile, apps/portal `dependencies`: the apps bundle it); `@simplewebauthn/server` `13.3.3` (apps/api `devDependencies`). After `pnpm install`, the lockfile resolves `@better-auth/passkey`'s own `@simplewebauthn/*` to the same versions; if it does not, align the pins to what it resolves.
- Routes reach the user only through `request.actor` and decide only through `authorize` or `decide`. A route never compares the confirmation windows itself. Every endpoint behind a permission has one `expectStatuses` test with the standard cast.
- Answers: 401 without a login; 404 for what the actor may not see at all; 403 `not_allowed` for what they may see but not change; 403 `passkey_required` when only a confirmation is missing; 409 for a conflict.
- Every other admin action answers exactly as before this pull request, with or without a confirmed session. No existing `expectStatuses` table changes.
- No switch (environment variable, header, query parameter) turns the passkey rules off. Tests stamp `passkey_verified_at` through the test helper `stampSession`, which the release does not contain.
- No public key, credential ID, challenge or session token in a log line, a mail, a mail job, an audit entry, or the answer of a verify route. Audit entries hold no name or address (people by ID only); mail jobs hold IDs only.
- The four Better Auth passkey routes are the only additions to `AUTH_PATHS`. Better Auth's `list-user-passkeys`, `delete-passkey` and `update-passkey` stay unmounted (404).
- The app's login screen does not change. A volunteer or coordinator without an admin role never sees the word "toegangssleutel".
- The API stays backward compatible: only add fields to existing responses.
- Fixtures, seed data and test addresses are made up and end in `@example.test`.
- Dutch copy in this plan is exact. Where a small text is missing, write it in the same style.
- Commit after every task with a message in English, ending with the co-author line your session's instructions give. Do not push after every commit.

Numbers (the spec's): confirmed for 24 hours after the last passkey (`ADMIN_PASSKEY_CONFIRMATION_WINDOW`), recently confirmed for 10 minutes (`ADMIN_PASSKEY_RECENT_CONFIRMATION_WINDOW`), measured from `passkey_verified_at`, never extended by use; a first passkey needs a session at most one day old (Better Auth's `freshAge` default, kept); at most 10 passkeys per account.

Dutch texts used in more than one task:

| Code or situation                                   | Text                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modal with a passkey: title, text, button           | `Bevestig dat jij het bent`, `Voor beheer vraagt PadVinder om je toegangssleutel.`, `Gebruik je toegangssleutel`                                                                                                                         |
| Modal without one: title, text, button              | `Maak een toegangssleutel`, `Voor beheer heb je een toegangssleutel nodig. Je telefoon of laptop bewaart hem en vraagt om je vingerafdruk, gezicht of pincode. Je maakt hem één keer.`, `Maak een toegangssleutel`                       |
| Modal, second button                                | `Annuleer`                                                                                                                                                                                                                               |
| `cancelled`, `failed`                               | `Dat lukte niet. Probeer het nog eens.`                                                                                                                                                                                                  |
| `other_account`                                     | `Deze toegangssleutel hoort bij een ander account.`                                                                                                                                                                                      |
| `session_too_old`, with the button `Log opnieuw in` | `Log eerst opnieuw in met een code uit je mail. Daarna maak je een toegangssleutel.`                                                                                                                                                     |
| `unsupported`                                       | `Deze browser kan geen toegangssleutel gebruiken. Gebruik een recente versie van Chrome, Safari, Edge of Firefox.`                                                                                                                       |
| `already_registered`                                | `Deze toegangssleutel staat al op je account.`                                                                                                                                                                                           |
| `unknown_passkey` (login screen)                    | `Deze toegangssleutel werkt niet meer. Log in met een code uit je mail.`                                                                                                                                                                 |
| `not_allowed` (adding one without an admin role)    | `Alleen beheerders maken een toegangssleutel.`                                                                                                                                                                                           |
| `too_many_passkeys`                                 | `Je hebt al tien toegangssleutels. Verwijder er eerst een.`                                                                                                                                                                              |
| `too_busy`                                          | as the login's `too_busy`                                                                                                                                                                                                                |
| API code `passkey_required` (`apiErrorMessage`)     | `Bevestig eerst met je toegangssleutel.`                                                                                                                                                                                                 |
| Portal login button                                 | `Log in met je toegangssleutel`                                                                                                                                                                                                          |
| Profile button, passkeys screen heading             | `Toegangssleutels`                                                                                                                                                                                                                       |
| Admin row without a passkey; row action             | `Nog geen toegangssleutel`; `Verwijder toegangssleutels`                                                                                                                                                                                 |
| Reset question: title, text, buttons                | `Toegangssleutels van {naam} verwijderen?`, `Doe dit als {naam} geen toegangssleutel meer heeft, bijvoorbeeld na het kwijtraken van een telefoon. Daarna maakt {naam} een nieuwe bij de volgende keer beheren.`, `Verwijder`, `Annuleer` |
| Reset done (toast)                                  | `De toegangssleutels van {naam} zijn verwijderd.`                                                                                                                                                                                        |

`{naam}` is `nameInSentence` of the person, or their address when they have no name (as the platform admins page does since its final review).

## Review Focus

1. **Someone else's passkey on a shared laptop.** Two admins use one laptop. One is logged in, and the browser offers the other's passkey in the confirmation. The server refuses: no session is made, the old session and its cookie keep working, and the modal says `Deze toegangssleutel hoort bij een ander account.` On the login screen, without a session, any account's passkey logs in. Pinned in Task 6 and Task 9.
2. **A lost laptop with a confirmed session.** After another admin resets that person's passkeys, every session of the person is unconfirmed at once. The next passkey endpoint answers `passkey_required` there, and the old cookie of a session that a confirmation replaced no longer logs in at all. Pinned in Task 4, Task 6 and Task 7.
3. **The person cancels, waits, or taps twice.** The browser's dialog is cancelled or times out, or the button is tapped twice. Several requests fail with `passkey_required` at once. A background request fails the same way. The modal shows once, starts one ceremony at a time, and shows `Dat lukte niet. Probeer het nog eens.` after a cancel. `Annuleer` leaves the page with its usual error, and a background request never opens the modal. Pinned in Task 8 and Task 9.
4. **Things change between two steps.** A passkey is removed between the options and the verification. An account is deleted while its added-passkey mail waits in the queue. Someone loses the admin role while the passkeys screen is open. A session turns a day old between the two registration calls. Every case gives a clear answer, never a 500: an unknown passkey on the login screen, a dropped mail, 403 `not_allowed`, and `SESSION_NOT_FRESH` shown as `session_too_old`. Pinned in Task 3, Task 6 and Task 7.
5. **Secrets leak by a side door.** No answer of the verify routes holds a session token, a public key or a credential ID. No log line holds a challenge or a credential ID, also when SimpleWebAuthn's error quotes one. No audit entry or mail job holds more than IDs. Pinned in Task 4, Task 6 and Task 7.

## What pull request 2 builds on

Pull request 2 ("Admin power needs them") uses these names from this plan. Its plan refers to them as they are built; check the "Deviations" at the end of this plan first.

- `Actor.passkeyVerifiedAt: Date | null` and `Actor.now: Date` (`apps/api/src/permissions/actor.ts`); `confirmationOf(actor)`, `hasAdminRole(actor)`, `adminConfirmedUntil(actor)`, `ADMIN_PASSKEY_CONFIRMATION_WINDOW`, `ADMIN_PASSKEY_RECENT_CONFIRMATION_WINDOW` (`apps/api/src/permissions/confirmation.ts`).
- `Decision` with `"confirm"`, and the table `requiredConfirmation(permission)` in `rules.ts`, which pull request 2 extends with the rule "allowed only because of an admin relation". `authorize` throws 403 `passkey_required` for `confirm`.
- `apiErrorCodes.passkeyRequired` and `apiErrorMessage("passkey_required")`.
- `usePasskeyConfirmation()`, `requestPasskeyConfirmation(queryClient)`, `backgroundRequestMeta` and `reopenServerEvents()` (`packages/api-client`); `PasskeyModal` (`packages/ui`); the hosts `apps/portal/src/auth/passkey-confirmation-host.tsx` and `apps/mobile/src/auth/passkey-confirmation-host.tsx`.
- `MeResponse.adminConfirmedUntil`, which pull request 2's app lists read.
- `backgroundRequestMeta` is not used anywhere yet: pull request 2 applies it to the Aanmeldingen badge (the sum over `useManagedWorkingGroups`) and the app's Meer counts. Until then, and for any query without it, Annuleer does not stop the modal for good: only window-focus refetches skip a query that failed with `passkey_required` (`refetchOnWindowFocus` in `packages/api-client/src/query-client.ts`), so a live-event refetch (`refetchAdministration` on `access-changed` or `membership-requests-changed`, or when the event stream reopens) of such a query fails again and opens the modal again.
- `stampSession(ctx, cookie, at)` (`apps/api/src/testing/passkeys.ts`). In this pull request the cast's three admins are stamped at login; pull request 2 adds the unconfirmed members.

---

### Task 1: The `passkeys` table and the session column

**Files:**

- Modify: `packages/db/src/schema/auth.ts`, `packages/db/src/accounts.ts`
- Create (generated): one migration
- Test: `packages/db/src/migrate.test.ts`, `packages/db/src/accounts.test.ts`

**Interfaces:**

- Produces (schema, next to `sessions`):
  - `sessions.passkeyVerifiedAt`: `timestamptz("passkey_verified_at")`, nullable, no default. The comment says it is ours: the moment a passkey was last used for this session, set only by the session-create hook.
  - `passkeys` (`pgTable("passkeys")`), keys exactly as Better Auth's model: `id` (`id()`), `name` text, `publicKey` (`public_key`) text not null, `userId` (`user_id`) uuid not null references `users.id` on delete cascade, `credentialID` (`credential_id`) text not null **unique**, `counter` `bigint(..., { mode: "number" })` not null (a WebAuthn counter is 32 bits unsigned, more than `integer` holds), `deviceType` (`device_type`) text not null, `backedUp` (`backed_up`) boolean not null, `transports` text, `createdAt` (`created_at`) timestamptz not null default now, `aaguid` text. Index `passkeys_user_id_idx` on `user_id`.
- `deleteAccount` also deletes the person's `passkeys` rows, in its transaction next to `sessions` (the user row stays, so the cascade does not fire).

- [ ] **Step 1: Write the failing tests.**

```ts
// migrate.test.ts (add)
test("the passkeys migration applies to a database that holds users and sessions; existing sessions are unconfirmed", ...);
test("a second passkey with the same credential_id is refused", ...);
// accounts.test.ts (add)
test("deleteAccount deletes the person's passkeys and keeps other people's", ...);
test("a blocked deletion keeps the passkeys", ...);
```

- [ ] **Step 2: Run them.** `pnpm vitest run packages/db/src/migrate.test.ts packages/db/src/accounts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm db:generate`.
- [ ] **Step 4: Run.** `pnpm db:migrate && pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the passkeys table and the session's passkey moment"`

---

### Task 2: Audit actions for passkeys

**Files:**

- Modify: `packages/contracts/src/audit-log.ts`, `packages/contracts/src/fixtures/audit-log.ts`, `packages/db/src/audit-log.ts`, `packages/ui/src/lib/audit-log.ts`, `apps/portal/src/pages/audit-log-page.tsx`
- Test: `packages/contracts/src/audit-log.test.ts`, `packages/ui/src/lib/audit-log.test.ts`, `packages/db/src/audit-log-entries.test.ts`, `apps/portal/src/pages/audit-log-page.test.tsx`

**Interfaces:**

- Produces: `auditActions` gains `passkey.added`, `passkey.removed` and `passkey.reset`. `auditActionPrefixes.account` becomes `["account.", "passkey."]`. `AuditSubject.type` is `user` for all three, with no details.
- Sentences (`sentences` in `packages/ui/src/lib/audit-log.ts`):

| Action            | Sentence                                      |
| ----------------- | --------------------------------------------- |
| `passkey.added`   | `Toegangssleutel toegevoegd: {persoon}`       |
| `passkey.removed` | `Toegangssleutel verwijderd: {persoon}`       |
| `passkey.reset`   | `Alle toegangssleutels verwijderd: {persoon}` |

- `organizationAdminActionGroups` in the audit log page keeps `account`, without `species`. An organization admin's log now holds `passkey.reset` entries of their organization, and the filter group must reach them. The group's label stays `Accounts`.

- [ ] **Step 1: Write the failing tests.**

```ts
test("passkey.added, passkey.removed and passkey.reset fall in the group account", ...);
test.each([
  ["passkey.added", "Toegangssleutel toegevoegd: Noor de Vries"],
  ["passkey.removed", "Toegangssleutel verwijderd: Noor de Vries"],
  ["passkey.reset", "Alle toegangssleutels verwijderd: Noor de Vries"],
])("%s reads %j", ...);
// audit-log-entries.test.ts (add)
test("an organization admin reads a passkey.reset of their organization, and no passkey entry without one", ...);
// audit-log-page.test.tsx (change): an organization admin's Actie offers Accounts and no Soorten
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add the three actions to the fixture as well.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the audit actions for passkeys"`

---

### Task 3: The two passkey mails

**Files:**

- Create: `packages/mail/src/passkey-mails.ts`
- Modify: `packages/db/src/mail-jobs.ts`, `packages/mail/src/job-mail.ts`, `packages/mail/src/index.ts`
- Test: `packages/mail/src/passkey-mails.test.ts`, `packages/mail/src/job-mail.test.ts`, `packages/db/src/mail-jobs.test.ts`

**Interfaces:**

- Produces (`mailJobSchema`, strict, IDs only):
  - `{ kind: "passkey-added"; userId; passkeyId }`
  - `{ kind: "passkeys-removed"; userId; byUserId }`. `byUserId` equals `userId` when the person removed one of their own.
- Produces (`MailJobData`):
  - `{ kind: "passkey-added"; to; recipientName; addedAt: Date }`. `loadMailJobData` answers null when the account is gone or deleted, or the passkey row is gone (it was removed before the mail went out; that removal sends its own mail).
  - `{ kind: "passkeys-removed"; to; recipientName; byOther: boolean; byName: string | null; remaining: number }`. `byOther` is `byUserId !== userId`; `byName` is `loadByName(byUserId)` when `byOther`; `remaining` counts the person's passkeys at sending time. Null when the account is gone or deleted.
- Produces (`packages/mail`): `buildPasskeyAddedMail(data)` and `buildPasskeysRemovedMail(data)`. Both start with `greeting(recipientName)` and an empty line, run names through `singleLine` and HTML through `escapeHtml`, and have no link.
  - Added. Subject `Er is een toegangssleutel toegevoegd aan je account`. Body: `Er is op {datum} om {tijd} een toegangssleutel toegevoegd aan je PadVinder-account. Deed je dat zelf? Dan hoef je niets te doen. Deed je het niet? Neem dan meteen contact op met een hoofdbeheerder of met een andere beheerder van je organisatie.` `{datum}` is like `26 november 2026` and `{tijd}` like `14:05`, both in Europe/Amsterdam.
  - Removed by someone else. Subject `Je toegangssleutels zijn verwijderd`. Body: `{naam} heeft je toegangssleutels voor PadVinder verwijderd. Je maakt een nieuwe de volgende keer dat je iets beheert in PadVinder.` Without a usable `byName`, `{naam}` is `Een beheerder`.
  - Removed by the person, none left. Same subject. Body: `Je toegangssleutels voor PadVinder zijn verwijderd. Je maakt een nieuwe de volgende keer dat je iets beheert in PadVinder. Deed je dat niet zelf? Neem dan meteen contact op met een hoofdbeheerder of met een andere beheerder van je organisatie.`
  - Removed by the person, some left. Subject and first sentence `Er is een toegangssleutel verwijderd van je account.`, then the same `Deed je dat zelf? …` advice as the added mail.
- `buildMailForJob` gains both cases; the switches stay exhaustive.

- [ ] **Step 1: Write the failing tests.**

```ts
test("the added mail names the date and time in Europe/Amsterdam", ...); // 2026-11-26T13:05:00Z -> "26 november 2026 om 14:05"
test("each mail starts with the greeting and holds no link, no ID and no credential material", ...);
test("removed by someone else names them; without a name it says Een beheerder", ...);
test("removed by the person: the text differs with none and with some left", ...);
test("markup and a line break in a name do not break the mail", ...);
// mail-jobs.test.ts (add)
test("a passkey job with an extra key is refused", ...);
test("passkey-added is dropped when the passkey or the account is gone", ...);
test("passkeys-removed counts the passkeys left when it is sent", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the mails about added and removed passkeys"`

---

### Task 4: Passkeys in `packages/db`

**Files:**

- Create: `packages/db/src/passkeys.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/src/organizations.ts`, `packages/db/src/platform-admins.ts`, `packages/db/src/login-code-requests.ts`, `packages/contracts/src/organizations.ts`, `packages/contracts/src/platform-admins.ts`, their fixtures
- Test: `packages/db/src/passkeys.test.ts`, `packages/db/src/organizations.test.ts`, `packages/db/src/platform-admins.test.ts`, `packages/db/src/login-code-requests.test.ts`

**Interfaces:**

- Consumes: `recordAudit`, `QueueMail`, `AuditActor`; the table of Task 1, the actions of Task 2, the jobs of Task 3.
- Produces (from `@padvinder/db`):
  - `MAX_PASSKEYS_PER_ACCOUNT = 10`.
  - `listOwnPasskeys(db: Db, userId: string): Promise<{ id: string; createdAt: Date; backedUp: boolean }[]>`, oldest first. It reads no key material.
  - `countPasskeys(db: Db, userId: string): Promise<number>`.
  - `userHasPasskey`: a SQL expression (`exists (select 1 from passkeys where user_id = users.id)`), in the style of `userHasLoggedIn`, for lists.
  - `recordPasskeyAdded(db: Db, input: { userId: string; passkeyId: string }, options: { queueMail?: QueueMail }): Promise<void>`: one transaction with `passkey.added` (actor the user, organization null) and the job `passkey-added`. Better Auth inserted the row before this is called.
  - `removeOwnPasskey(db: Db, input: { userId: string; passkeyId: string }, options: { queueMail?: QueueMail }): Promise<{ outcome: "removed" | "not_found" }>`: deletes that row only when it is the user's own; then `passkey.removed` (actor the user, organization null) and `passkeys-removed` with `byUserId` the user, in one transaction. The session moments stay.
  - `resetPasskeys(db: Db, input: { userId: string; organizationId: string | null }, actor: { kind: "user"; userId: string }, options: { queueMail?: QueueMail }): Promise<{ removed: number }>`, in one transaction. It deletes all of the person's passkeys and sets `passkey_verified_at` to null on all their sessions, always. When at least one passkey was removed, it writes `passkey.reset` (organization from the input) and queues `passkeys-removed` with `byUserId` the actor. With none removed it writes no entry and queues no mail.
  - `OrganizationAdmin` and `PlatformAdmin` (contracts) gain `hasPasskey: boolean`, filled by `getOrganization` and `listPlatformAdmins` with `userHasPasskey`. `OrganizationAdmin` also gains `mayResetPasskeys: boolean`, which the route fills (Task 7); `getOrganization` returns it as `false`.
  - `pruneLoginData` also deletes `verifications` rows whose `expires_at` lies more than a day in the past. A registration challenge row holds the account's address for its 5 minutes, and an abandoned one would otherwise stay.

- [ ] **Step 1: Write the failing tests** (rows inserted directly; Task 6 makes them through Better Auth).

```ts
test("listOwnPasskeys gives id, createdAt and backedUp, oldest first, and only the user's own", ...);
test("recordPasskeyAdded writes passkey.added without details and queues passkey-added with IDs only", ...);
test("removeOwnPasskey removes the user's own and answers not_found for someone else's, which stays", ...);
test("removeOwnPasskey writes passkey.removed and queues passkeys-removed with byUserId the user", ...);
test("resetPasskeys removes all, clears passkey_verified_at on every session of that person and of nobody else", ...);
test("resetPasskeys writes passkey.reset with the organization given, or none", ...);
test("resetPasskeys of a person without passkeys clears the sessions and writes no entry and no mail", ...);
test("no entry and no job holds a name, an address or a credential ID", ...); // raw JSON of the rows: no "@", no credential_id value
test("getOrganization and listPlatformAdmins say who has a passkey", ...);
test("pruneLoginData deletes expired challenge rows and keeps a valid login code", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add, remove and reset passkeys in the database, with audit entries and mails"`

---

### Task 5: The windows on the actor, and `confirm` in `decide`

**Files:**

- Create: `apps/api/src/permissions/confirmation.ts`, `apps/api/src/testing/passkeys.ts`
- Modify: `apps/api/src/permissions/actor.ts`, `apps/api/src/permissions/rules.ts`, `apps/api/src/auth/auth.ts` (only `session.additionalFields`), `apps/api/src/testing/cast.ts`, `packages/contracts/src/errors.ts`, `packages/ui/src/lib/messages.ts`
- Test: `apps/api/src/permissions/confirmation.test.ts`, `apps/api/src/permissions/rules.test.ts`, `apps/api/src/permissions/actor.test.ts`, `apps/api/src/testing/cast.test.ts`, `packages/ui/src/lib/messages.test.ts`

**Interfaces:**

- Produces (`confirmation.ts`):
  - `ADMIN_PASSKEY_CONFIRMATION_WINDOW = 24 * 60 * 60 * 1000` and `ADMIN_PASSKEY_RECENT_CONFIRMATION_WINDOW = 10 * 60 * 1000` (milliseconds).
  - `type Confirmation = "recent" | "confirmed" | "none"`.
  - `confirmationOf(actor: Pick<Actor, "passkeyVerifiedAt" | "now">): Confirmation`: with `age = now - passkeyVerifiedAt`, `recent` for `0 <= age < 10 min`, `confirmed` for `age < 24 h`, otherwise `none` (also for null and for a moment in the future).
  - `hasAdminRole(actor: Pick<Actor, "isPlatformAdmin" | "adminOfOrganizationIds">): boolean`.
  - `adminConfirmedUntil(actor: Actor): Date | null`: `passkeyVerifiedAt + 24 h` when `hasAdminRole` and `confirmationOf` is not `none`, else null.
- Produces (`actor.ts`): `Actor` gains `passkeyVerifiedAt: Date | null` (the session's `passkeyVerifiedAt`, read with the session in `readSession`) and `now: Date` (set once when the actor is made). Better Auth knows the column as `session.additionalFields.passkeyVerifiedAt` (`type: "date"`, `required: false`, `input: false`), so no client can set it.
- Produces (`rules.ts`):
  - `Decision = "allowed" | "forbidden" | "hidden" | "confirm"`. `authorize` throws 403 `passkey_required` ("Confirm with a passkey first") for `confirm`.
  - New permissions:

| Action                                | Target                                               | Platform admin | Organization admin                                 | Everyone else                             | Window                         |
| ------------------------------------- | ---------------------------------------------------- | -------------- | -------------------------------------------------- | ----------------------------------------- | ------------------------------ |
| `passkeys.listOwn`                    | none                                                 | allowed        | allowed                                            | forbidden                                 | 24 h                           |
| `passkeys.removeOwn`                  | none                                                 | allowed        | allowed                                            | forbidden                                 | 10 min                         |
| `passkeys.add`                        | `{ hasPasskey: boolean }`                            | allowed        | allowed                                            | forbidden                                 | 10 min, only when `hasPasskey` |
| `organization.resetAdminPasskeys`     | organization, plus `subjectIsPlatformAdmin: boolean` | allowed        | allowed, `forbidden` when `subjectIsPlatformAdmin` | hidden (also its working groups' members) | 10 min                         |
| `platform.resetPlatformAdminPasskeys` | none                                                 | allowed        | forbidden                                          | forbidden                                 | 10 min                         |

- `requiredConfirmation(permission: Permission): "none" | "confirmed" | "recent"`, one exhaustive switch next to `decide`: the windows above, `"none"` for every existing action. `decide` first decides by roles as today. Then, when that is `allowed`, it compares `requiredConfirmation` with `confirmationOf(actor)` and answers `confirm` when the window is not met. Pull request 2 adds its rule in this same place.
- Produces (contracts and ui): `apiErrorCodes.passkeyRequired = "passkey_required"` and `apiErrorCodes.tooManyPasskeys = "too_many_passkeys"`; `apiErrorMessage` texts for both (table at the top).
- Produces (`testing/passkeys.ts`): `stampSession(ctx: TestApp, cookie: string, at: Date | null): Promise<void>`. It sets `passkey_verified_at` on the session whose token is in the cookie (the signed cookie value is `token.signature`, URL-encoded). It is not exported from the API's entry points, so the release cannot reach it. `createCast` stamps `platformAdmin`, `organizationAdmin` and `organizationAdminOtherOrganization` with `new Date()` right after their login.

- [ ] **Step 1: Write the failing tests** (an injected `now` on hand-built actors).

```ts
// confirmation.test.ts
test.each([
  [null, "none"],
  [0, "recent"],
  [10 * 60 * 1000 - 1, "recent"],
  [10 * 60 * 1000, "confirmed"],
  [24 * 60 * 60 * 1000 - 1, "confirmed"],
  [24 * 60 * 60 * 1000, "none"],
  [-1, "none"],
])("a passkey %j ms ago is %s", ...);
test("adminConfirmedUntil is passkeyVerifiedAt + 24 h for an admin, null for a non-admin or an unconfirmed session", ...);
// rules.test.ts (add)
test("every existing action decides the same with and without a confirmation", ...); // all existing Permission cases × a confirmed and an unconfirmed copy of each actor
test.each(["passkeys.listOwn", "passkeys.removeOwn", "platform.resetPlatformAdminPasskeys"])("%s: per the table, and confirm outside its window", ...);
test("passkeys.add: allowed without a passkey from any session; with one, confirm unless recently confirmed; forbidden without an admin role", ...);
test("organization.resetAdminPasskeys: an admin of another organization and a coordinator of its group get hidden; an organization admin gets forbidden for a platform admin", ...);
test("authorize throws 403 passkey_required for confirm", ...);
// actor.test.ts (add)
test("the actor carries the session's passkeyVerifiedAt, and null for a code session", ...);
// cast.test.ts (add)
test("the cast's three admins are recently confirmed; nobody else is stamped", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS: every existing API test passes unchanged.
- [ ] **Step 5: Commit.** `git commit -m "Carry the passkey moment on the actor and add the confirm decision"`

---

### Task 6: Better Auth's passkey routes

**Files:**

- Create: `apps/api/src/auth/passkey-routes.ts`, `apps/api/src/testing/soft-authenticator.ts`
- Modify: `apps/api/src/auth/auth.ts`, `apps/api/src/auth/auth-routes.ts`, `apps/api/src/auth/login-rate-limit.ts`, `apps/api/src/app.ts`, `apps/api/src/testing/passkeys.ts`, `apps/api/package.json`, `pnpm-lock.yaml`
- Test: `apps/api/src/auth/passkeys.test.ts`, `apps/api/src/auth/soft-authenticator.test.ts`, `apps/api/src/auth/login.test.ts`, `apps/api/src/auth/auth.test.ts` (the log scrub, if no such file exists put it in `login.test.ts`)

**Interfaces:**

- Consumes: Task 4's `recordPasskeyAdded`, `countPasskeys`, `MAX_PASSKEYS_PER_ACCOUNT`; Task 5's `loadActor`, `authorize` with `passkeys.add`.
- Produces (Better Auth configuration, `auth.ts`):
  - The plugin `passkey({ rpID: new URL(env.PUBLIC_ORIGIN).hostname, rpName: "PadVinder", origin: env.ALLOWED_ORIGINS, authenticatorSelection: { residentKey: "required", userVerification: "required" }, authentication: { afterVerification } })`, and `schema.passkey: passkeys` in the Drizzle adapter.
  - `afterVerification({ ctx, clientData })`: read the cookie's session with `getSessionFromCtx(ctx)` (from `better-auth/api`). When there is one and the passkey with credential ID `clientData.id` belongs to another user, throw `APIError.from("FORBIDDEN", { code: "PASSKEY_OF_OTHER_ACCOUNT", message: "This passkey belongs to another account" })`. No session is made, and the old one stays. It runs after the signature check, so nothing is decided on an unverified passkey.
  - `databaseHooks.session.create.before(session, context)`: as today, plus `passkeyVerifiedAt: new Date()` when `context?.path` is `/passkey/verify-authentication` or `/passkey/verify-registration`. Any other path leaves it unset. The `after` hook is unchanged.
  - `rateLimit.customRules` gains `/passkey/generate-register-options` and `/passkey/generate-authenticate-options`: `IP_LIMITS.passkeyOptions = { window: 300, max: 60 }`; `/passkey/verify-registration` and `/passkey/verify-authentication`: `IP_LIMITS.passkeyVerify = { window: 300, max: 60 }`.
  - `forwardLog`'s `scrub` also replaces every double-quoted value with `"[redacted]"`, so SimpleWebAuthn's messages lose the challenge and the origin they quote.
- Produces (routes, `passkey-routes.ts`, registered by `authRoutes` with `{ auth, origin, db, queueMail }`): `AUTH_PATHS` gains the four paths, every one mounted as `POST` only (a `GET` is 404). Each route:
  - `generate-register-options`: loads the actor with `loadActor` (401 `not_logged_in` without one) and `authorize(actor, { action: "passkeys.add", hasPasskey })`. Without an admin role that is 403 `not_allowed`; with a passkey and no recent confirmation, 403 `passkey_required`. With `countPasskeys >= MAX_PASSKEYS_PER_ACCOUNT` it answers 409 `too_many_passkeys`. These answers are in our error format (`apiError`). Then it passes the request on to Better Auth as `GET`, without query or body, and answers Better Auth's options as they are, with its cookie.
  - `verify-registration`: the same checks first. Then it rewrites the body to `{ response: body.response, createSession: true }`, whatever the client sent, and passes it on. On 2xx it reads the passkey's `id` from Better Auth's answer, calls `recordPasskeyAdded` (a failure there is logged with the error class only, and the answer is still success), deletes the previous session (below), copies the cookies, and answers `{ ok: true }`.
  - `generate-authenticate-options`: passes on as `GET`, without query or body, and answers the options as they are.
  - `verify-authentication`: passes on `{ response: body.response }`. On 2xx it deletes the previous session and answers `{ ok: true }` with the cookies.
  - **The previous session.** Before passing a verify call on, the route reads the cookie's session with `app.auth.api.getSession({ headers, query: { disableRefresh: true } })`. After a 2xx it deletes that session with `(await auth.$context).internalAdapter.deleteSession(token)`. A refused call deletes nothing.
  - A Better Auth error (4xx) is answered as Better Auth sent it, with its `code` (for example `SESSION_NOT_FRESH`, `PASSKEY_NOT_FOUND`, `CHALLENGE_NOT_FOUND`, `PASSKEY_OF_OTHER_ACCOUNT`), as the code routes do. An unexpected error is 500 `internal_error`, logged through `forwardLog`.
- Produces (`testing/soft-authenticator.ts`): `createSoftAuthenticator(input: { origin: string; userVerified?: boolean }): SoftAuthenticator`, where `SoftAuthenticator = { credentialId: string; register(optionsJSON): RegistrationResponseJSON; authenticate(optionsJSON): AuthenticationResponseJSON }`. It holds one P-256 key pair (`node:crypto`). It builds `clientDataJSON` (`webauthn.create` or `webauthn.get`, the options' challenge, `origin`), authenticator data (SHA-256 of `rp.id` or `rpId`; flags UP, UV unless `userVerified: false`, AT on registration; counter), a COSE EC2 key and a `"none"` attestation object with `isoCBOR.encode`, and an ES256 signature over `authData || sha256(clientDataJSON)`. `userHandle` is the registration's `user.id`.
- Produces (`testing/passkeys.ts`): `addPasskey(ctx, cookie, authenticator): Promise<{ cookie: string; response }>` and `usePasskey(ctx, cookie | null, authenticator): Promise<{ cookie: string | null; response }>`. Each runs the two calls with `Origin` set to the app's origin and returns the new session cookie.

- [ ] **Step 1: Write the failing tests** (`createTestApp`, `loginAs`, the soft authenticator; an admin is made with `grantPlatformAdmin` or `createOrganization`).

```ts
// soft-authenticator.test.ts
test("its registration and assertion pass SimpleWebAuthn's verify functions", ...);
// passkeys.test.ts
test("an admin adds a first passkey from a code session, and the new session is stamped", ...);
test("the registration replaces the session: the old cookie is 401 on /api/me, the new one works", ...);
test("createSession: false from the client still makes and stamps a new session and deletes the old one", ...);
test("a second passkey is 403 passkey_required without a recent confirmation, and allowed with one", ...); // stampSession 11 min ago, then now
test("an eleventh passkey is 409 too_many_passkeys", ...);
test("a volunteer, a coordinator and an applicant get 403 not_allowed on both registration routes", ...);
test("a code session older than a day gets SESSION_NOT_FRESH on a first passkey", ...); // sessions.created_at set back 25 h
test("logging in with a passkey without a cookie makes a stamped session for the passkey's account", ...);
test("a confirmation replaces the session and stamps the new one; the old cookie is 401", ...);
test("another account's passkey in a confirmation is 403 PASSKEY_OF_OTHER_ACCOUNT; no session is made, the old one still works", ...);
test("a passkey that was removed answers PASSKEY_NOT_FOUND and makes no session", ...);
test("an assertion without user verification is refused", ...); // userVerified: false
test("a code login is not stamped", ...);
test("the verify answers are { ok: true }: no token, no publicKey, no credentialID, no session in the raw body", ...);
test("the options hold no other account's credential ID and no public key", ...); // excludeCredentials / allowCredentials hold only the session account's own
test("GET on each of the four paths is 404; a POST with a foreign Origin is refused", ...);
test("list-user-passkeys, delete-passkey and update-passkey are 404", ...);
test("adding writes passkey.added and queues passkey-added", ...); // ctx.mailQueue.jobs
test("with LOGIN_RATE_LIMITS on, the 61st options request in 5 minutes from one address is 429", ...);
test("no log line of a failed verification holds the challenge or the credential ID", ...); // logStream, a wrong challenge
```

- [ ] **Step 2: Run them.** `pnpm vitest run apps/api/src/auth`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the dependencies first: `pnpm --filter @padvinder/api add @better-auth/passkey@1.7.27 --save-exact` and `pnpm --filter @padvinder/api add -D @simplewebauthn/server@13.3.3 --save-exact`.
- [ ] **Step 4: Run.** `pnpm check && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Mount Better Auth's passkey routes behind our checks"`

---

### Task 7: Our passkey endpoints, and the me fields

**Files:**

- Create: `packages/contracts/src/passkeys.ts`, `packages/contracts/src/fixtures/passkeys.ts`, `apps/api/src/routes/passkeys.ts`
- Modify: `packages/contracts/src/me.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/fixtures/index.ts` (and the me fixtures), `apps/api/src/routes/me.ts`, `apps/api/src/routes/organizations.ts`, `apps/api/src/routes/platform-admins.ts`, `apps/api/src/app.ts`
- Create (generated): the OpenAPI file and client
- Test: `apps/api/src/routes/passkeys.test.ts`, `apps/api/src/routes/me.test.ts`, `apps/api/src/routes/organizations.test.ts`, `apps/api/src/routes/platform-admins.test.ts`

**Interfaces:**

- Consumes: Tasks 4 and 5; Task 6's helpers for the tests.
- Produces (contracts):
  - `passkeySchema` (component `Passkey`): `{ id: string; createdAt: string; backedUp: boolean }`; `passkeyListResponseSchema` (component `PasskeyListResponse`): `{ passkeys: Passkey[] }`.
  - `meResponseSchema`: `user.hasPasskey: boolean`, and top-level `adminConfirmedUntil: string | null` (ISO 8601, from `adminConfirmedUntil(actor)`). Both are additions.
  - `organizationAdminSchema` gains `hasPasskey` and `mayResetPasskeys`; `platformAdminSchema` gains `hasPasskey`. The fixtures hold one admin without a passkey each.
  - `passkeyErrors` (as `loginErrors`, not in OpenAPI): `cancelled`, `failed`, `other_account`, `session_too_old`, `unsupported`, `already_registered`, `unknown_passkey`, `not_allowed`, `confirmation_required`, `too_many_passkeys`, `too_busy`; `type PasskeyResult = { ok: true } | { ok: false; error: PasskeyError }`.
- Produces (API), every route with `preHandler: app.requireActor`:

| Endpoint                                                  | operationId                      | Permission                            | Answers                                          |
| --------------------------------------------------------- | -------------------------------- | ------------------------------------- | ------------------------------------------------ |
| `GET /api/passkeys`                                       | `listPasskeys`                   | `passkeys.listOwn`                    | 200 `PasskeyListResponse`; 401; 403              |
| `DELETE /api/passkeys/{passkeyId}`                        | `removePasskey`                  | `passkeys.removeOwn`                  | 204; 400; 401; 403; 404 (not one's own, or gone) |
| `DELETE /api/organizations/{id}/admins/{userId}/passkeys` | `resetOrganizationAdminPasskeys` | `organization.resetAdminPasskeys`     | 204; 400; 401; 403; 404; 409 `own_account`       |
| `DELETE /api/platform-admins/{userId}/passkeys`           | `resetPlatformAdminPasskeys`     | `platform.resetPlatformAdminPasskeys` | 204; 400; 401; 403; 404; 409 `own_account`       |

- Order in the organization route: `userId` is the actor's own → 409 `own_account`; `authorize(organization.view)` → 404 for an outsider; the person is no admin of that organization (or deleted) → 404; `authorize(organization.resetAdminPasskeys)` with `subjectIsPlatformAdmin` → 403 or `passkey_required`; then `resetPasskeys` with the organization's ID. The platform route: own → 409; `authorize(platform.resetPlatformAdminPasskeys)`; the person is no platform admin → 404; `resetPasskeys` with organization null. Both pass `queueMail`.
- `GET /api/organizations/{id}` fills `mayResetPasskeys` per admin: `decide(organization.resetAdminPasskeys)` is `allowed` or `confirm`, and the admin is not the actor. That way the page shows the action only where the API allows it, without telling an organization admin who is a platform admin.
- `GET /api/me` fills `user.hasPasskey` and `adminConfirmedUntil`.
- Every route that can answer `passkey_required` lists 403 in `errorResponses`; the generated schema has the code in `apiErrorCodes`.

- [ ] **Step 1: Write the failing tests** (the cast; its admins are recently confirmed, Task 5).

```ts
const adminsOnly = (ok: number) => ({ platformAdmin: ok, organizationAdmin: ok, coordinator: 403, volunteer: 403, volunteerOtherGroup: 403, coordinatorOtherOrganization: 403, organizationAdminOtherOrganization: ok, applicant: 403, anonymous: 401 });
test("only admins list their own passkeys", ...); // adminsOnly(200)
test("only admins remove one of their own", ...); // adminsOnly(204), a fresh passkey row per call
test("resetting an admin of the organization", ...);
// { platformAdmin: 204, organizationAdmin: 204, organizationAdminOtherOrganization: 404, coordinator: 404, volunteer: 404, volunteerOtherGroup: 404, coordinatorOtherOrganization: 404, applicant: 404, anonymous: 401 }
// target: a second admin of cast.organization with a passkey, recreated per call
test("resetting a platform admin", ...); // platformAdmin 204, everyone else 403, anonymous 401
test("an organization admin cannot reset a platform admin who is also an admin of the organization: 403", ...);
test("resetting yourself is 409 own_account on both routes, and your passkeys stay", ...);
test("someone who is no admin of the organization, or no platform admin, is 404", ...);
test("the list is passkey_required at 24 h; a removal and a reset are passkey_required at 10 min", ...); // stampSession 11 min and 25 h ago
test("a reset clears the confirmation of all the person's sessions: their next GET /api/passkeys is passkey_required", ...);
test("removing someone else's passkey by ID is 404 and it stays", ...);
test("the list holds id, createdAt and backedUp, and no key material", ...); // raw JSON: no publicKey, credentialID, counter, aaguid keys
test("a reset writes passkey.reset with the organization of the path, or none on the platform route", ...);
test("removing the last own passkey leaves hasPasskey false", ...);
// me.test.ts
test("me says hasPasskey, and adminConfirmedUntil for a confirmed admin only", ...); // admin confirmed, admin unconfirmed, volunteer
test("adminConfirmedUntil is the passkey moment plus 24 hours, with an offset", ...);
// organizations.test.ts, platform-admins.test.ts
test("each admin shows hasPasskey; mayResetPasskeys is false for yourself and for a platform admin when you are an organization admin", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the passkey endpoints and say on me who has one"`

---

### Task 8: `packages/api-client`: the passkey calls and the confirmation hook

**Files:**

- Create: `packages/api-client/src/passkey-client.ts`, `packages/api-client/src/passkey-confirmation.ts`, `packages/api-client/src/passkeys.ts`
- Modify: `packages/api-client/src/query-client.ts`, `packages/api-client/src/server-events.ts`, `packages/api-client/src/index.ts`, `packages/api-client/package.json`, `apps/mobile/package.json`, `apps/portal/package.json`, `pnpm-lock.yaml`
- Test: `packages/api-client/src/passkey-client.test.ts`, `packages/api-client/src/passkey-confirmation.test.tsx`, `packages/api-client/src/passkeys.test.tsx`, `packages/api-client/src/server-events.test.ts`

**Interfaces:**

- Consumes: Task 7's generated functions and `PasskeyError`/`PasskeyResult`; `refetchMe`, `refetchAdministration`, `logOut`, `apiErrorCode`.
- Produces (`passkey-client.ts`; never throws):
  - `passkeysSupported(): boolean` (`browserSupportsWebAuthn()`).
  - `createPasskey(): Promise<PasskeyResult>`: `POST /api/auth/passkey/generate-register-options` (same origin, JSON `{}`, cookies), `startRegistration({ optionsJSON })`, `POST …/verify-registration` with `{ response }`.
  - `authenticateWithPasskey(): Promise<PasskeyResult>`: the same with the two authentication routes and `startAuthentication`. The login screen and the confirmation both use it.
  - Error mapping: without WebAuthn → `unsupported`; `NotAllowedError` or `ERROR_CEREMONY_ABORTED` → `cancelled`; `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED` → `already_registered`; `SESSION_NOT_FRESH` → `session_too_old`; `PASSKEY_OF_OTHER_ACCOUNT` → `other_account`; `PASSKEY_NOT_FOUND` → `unknown_passkey`; `not_allowed` → `not_allowed`; `passkey_required` → `confirmation_required`; `too_many_passkeys` → `too_many_passkeys`; 429 → `too_busy`; anything else → `failed`.
- Produces (`server-events.ts`): `reopenServerEvents(): void`. Every open subscription closes its `EventSource` and connects again at once, which calls `onOpen` (and so refetches). The old stream was opened with the session the confirmation deleted.
- Produces (`passkey-confirmation.ts`):
  - `backgroundRequestMeta = { background: true } as const`: a query or mutation with this `meta` never opens the modal.
  - `createQueryClient()` gets one confirmation store per client. Its `QueryCache` and `MutationCache` `onError` report every error whose `apiErrorCode` is `passkey_required` and whose `meta` is not background: a query by its hash, a mutation by itself.
  - `requestPasskeyConfirmation(queryClient): void`: opens the modal without a failed request (the passkeys screen uses it on `confirmation_required`).
  - `usePasskeyConfirmation(): { open: boolean; pending: boolean; error: PasskeyError | null; hasPasskey: boolean; confirm(): void; cancel(): void; logInAgain(): void }`. `hasPasskey` comes from `me.user.hasPasskey`. `confirm()` runs `authenticateWithPasskey()` with a passkey and `createPasskey()` without one, once at a time (a second call while pending does nothing). On success it closes the modal, refetches me, calls `reopenServerEvents()`, refetches every reported query, refetches the passkeys list, and runs every reported mutation again with its variables (`mutation.execute(mutation.state.variables)`), so the screen's `useMutation` sees the result. Then it forgets them. On failure the modal stays open with `error`. `cancel()` closes it and forgets the reports: queries and mutations keep their error. `logInAgain()` calls `logOut()` and closes the modal.
  - Several reports while the modal is open, or while a confirmation runs, join the same round.
- Produces (`passkeys.ts`): `usePasskeys()` (the list query), `useRemovePasskey()` (takes the ID), `useResetOrganizationAdminPasskeys()` (takes `{ organizationId, userId }`) and `useResetPlatformAdminPasskeys()` (takes the user ID). The mutations throw the API's error body; when they settle they refetch the list, the organization, the platform admins and me. `useCreatePasskey(): { create(): void; pending: boolean; error: PasskeyError | null }` runs `createPasskey()`. On `confirmation_required` it calls `requestPasskeyConfirmation` and shows no error; on success it refetches me and the list.

- [ ] **Step 1: Write the failing tests** (`mockFetch`; `@simplewebauthn/browser` mocked with `vi.mock`).

```ts
// passkey-client.test.ts
test("createPasskey posts to the generate route, then posts the browser's response to verify-registration", ...);
test("the generate routes are called with POST, never GET", ...);
test.each([/* each server code and browser error of the mapping */])("%s gives %s", ...);
test("without WebAuthn nothing is sent and the answer is unsupported", ...);
// passkey-confirmation.test.tsx
test("a query that fails with passkey_required opens the modal; after confirm it is refetched and succeeds", ...);
test("three failing queries open the modal once and are all refetched after one confirmation", ...);
test("a mutation that failed with passkey_required runs again after confirm, and its useMutation shows success", ...);
test("a query with backgroundRequestMeta never opens the modal", ...);
test("cancel closes the modal and the query keeps its error", ...);
test("confirm twice while pending starts one ceremony", ...);
test("a failed ceremony keeps the modal open with its error", ...);
test("without a passkey, confirm creates one; with one, it authenticates", ...);
test("after a confirmation me is refetched and the event stream reopens", ...);
// server-events.test.ts
test("reopenServerEvents closes and reopens every open stream, and onOpen runs", ...);
// passkeys.test.tsx
test("useCreatePasskey asks for a confirmation on confirmation_required and shows no error", ...);
test("removing and resetting refetch the lists and me, also after an error", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add `@simplewebauthn/browser@13.3.0` (exact) to the three packages first.
- [ ] **Step 4: Run.** `pnpm check && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add passkey calls and the confirmation hook to the API client"`

---

### Task 9: `packages/ui`: the modal, the passkeys panel, the login button, the admin rows

**Files:**

- Create: `packages/ui/src/components/passkeys/passkey-modal.tsx`, `packages/ui/src/components/passkeys/passkeys-panel.tsx`, a `.stories.tsx` next to each
- Modify: `packages/ui/src/components/login/login-flow.tsx`, `packages/ui/src/components/login/email-form.tsx` (only if the button lives there), `packages/ui/src/components/profile/profile-form.tsx`, `packages/ui/src/components/administration/organization-admins-table.tsx`, `packages/ui/src/components/administration/platform-admins-table.tsx`, their stories, `packages/ui/src/lib/messages.ts`, `packages/ui/src/index.ts`
- Create (generated): reference images
- Test: next to each component, `packages/ui/src/lib/messages.test.ts`

**Interfaces:**

- Consumes: `Modal`, `ConfirmDialog`, `RowMenu`, `formatDate`, `displayName`, `nameInSentence`; `PasskeyError`, `PasskeyResult`, `Passkey`, `OrganizationAdmin`, `PlatformAdmin` and their fixtures.
- Produces:
  - `passkeyErrorMessage(error: PasskeyError): string`: the texts in the table at the top (`confirmation_required` reads `Bevestig eerst met je toegangssleutel.`).
  - `PasskeyModal(props: { open: boolean; hasPasskey: boolean; pending: boolean; error: PasskeyError | null; onConfirm(): void; onCancel(): void; onLogInAgain(): void })`: the two layouts of the design, exactly. The main button is large (a touch target) and disabled while pending, with `Even geduld…`. The error shows above the buttons in an alert region. With `session_too_old`, a button `Log opnieuw in` stands in place of the main button. The modal cannot be closed while pending. Stories: Confirm, Create, Pending, Cancelled, OtherAccount, SessionTooOld, Unsupported.
  - `PasskeysPanel(props: { passkeys: Passkey[] | undefined; loading: boolean; loadFailed: boolean; onRetry(): void; creating: boolean; createError: PasskeyError | null; onCreate(): void; removing: boolean; removeError?: string; onRemove(passkey: Passkey): void; phoneHint: boolean })`:
    - Heading `Toegangssleutels`, then `Met een toegangssleutel bevestig je dat jij het bent als je iets beheert. Je telefoon of laptop vraagt dan om je vingerafdruk, gezicht of pincode.`
    - One row per passkey: `Toegevoegd op {datum}`, with `Synchroniseert met je andere apparaten` below it when `backedUp`, and a button `Verwijder`. No passkeys: `Je hebt nog geen toegangssleutel.`
    - The button `Voeg een toegangssleutel toe` (`Even geduld…` while creating), and the create error below it. With `phoneHint`, the line `Wil je ook op je telefoon beheren? Kies dan in het venster voor je telefoon.` stands under it.
    - `Verwijder` asks with `ConfirmDialog`: title `Toegangssleutel verwijderen?`, text `Je kunt hem daarna niet meer gebruiken.`, or for the only one `Dit is je laatste toegangssleutel. Daarna maak je een nieuwe de volgende keer dat je iets beheert.`, confirm `Verwijder`. The dialog closes when `removing` turns false without `removeError`.
    - Loading: `Toegangssleutels laden…`; a failed load: the connection text with `Probeer opnieuw`.
    - Stories: Default (two, one synced), Empty, WithPhoneHint, CreateFailed, Loading.
  - `LoginFlowProps` gains `logInWithPasskey?: () => Promise<PasskeyResult>`. When it is given, the email step shows the button `Log in met je toegangssleutel` (outline, large) under the email form. On success it calls `onLoggedIn`; a failure shows `passkeyErrorMessage` in the step's error place. Without the prop nothing changes. `AuthGateView` passes `login` through as today. Stories: the existing ones unchanged, plus WithPasskey.
  - `ProfileFormProps.onDelete` becomes optional: without it the delete section does not show (the portal's profile). The app's story stays unchanged.
  - `OrganizationAdminsTable` gains `onResetPasskeys?(admin)`: the name cell shows `Nog geen toegangssleutel` (muted, below the name) where `hasPasskey` is false, and the row menu holds `Verwijder toegangssleutels` where `admin.mayResetPasskeys` (the menu shows when it has an item). `PlatformAdminsTable` gains the same, with `canResetPasskeys(admin): boolean` passed by the page. Stories: the existing ones gain one admin without a passkey.

- [ ] **Step 1: Write the failing tests.**

```tsx
test("the modal shows the passkey layout or the create layout by hasPasskey, with the design's texts", ...);
test("the main button is disabled while pending, and Escape does not close it then", ...);
test("session_too_old shows Log opnieuw in in place of the main button", ...);
test("the panel lists the date added, and Synchroniseert met je andere apparaten only for a synced passkey", ...);
test("removing the only passkey asks with the text for the last one", ...);
test("the phone hint shows only with phoneHint", ...);
test("the login step shows the passkey button only with logInWithPasskey, and calls onLoggedIn after success", ...);
test("a cancelled passkey login shows Dat lukte niet. Probeer het nog eens.", ...);
test("ProfileForm without onDelete has no delete button", ...);
test("an admin without a passkey shows Nog geen toegangssleutel; the reset action shows only where allowed", ...);
test.each([/* every PasskeyError */])("passkeyErrorMessage(%s) is its text", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm screenshots:update && pnpm test:visual:docker`. Expected: PASS, with new reference images to commit.
- [ ] **Step 5: Commit.** `git commit -m "Add the passkey modal, the passkeys panel and the passkey login button"`

---

### Task 10: Portal: login, profile, passkeys, repairing someone

**Files:**

- Create: `apps/portal/src/auth/passkey-confirmation-host.tsx`, `apps/portal/src/pages/profile-page.tsx`, `apps/portal/src/pages/passkeys-page.tsx`, `apps/portal/src/layout/require-admin-role.tsx`
- Modify: `apps/portal/src/auth/auth-gate.tsx`, `apps/portal/src/layout/portal-layout.tsx`, `apps/portal/src/router.tsx`, `apps/portal/src/pages/organization-page.tsx`, `apps/portal/src/pages/platform-admins-page.tsx`
- Test: `apps/portal/src/pages/profile-page.test.tsx`, `apps/portal/src/pages/passkeys-page.test.tsx`, `apps/portal/src/pages/organization-page.test.tsx`, `apps/portal/src/pages/platform-admins-page.test.tsx`, `apps/portal/src/layout/portal-layout.test.tsx`, `apps/portal/src/router.test.ts`

**Interfaces:**

- Consumes: Tasks 8 and 9; `useMe`, `useUpdateMe`, `showToast`, `NotFoundPage`.
- Produces:
  - `PasskeyConfirmationHost`: renders `PasskeyModal` from `usePasskeyConfirmation()`. `PortalLayout` renders it once, next to the `Toaster`.
  - `AuthGate` passes `logInWithPasskey: authenticateWithPasskey` to the login step.
  - The header's name becomes a link to `/profile` (`aria-label` `Profiel`). `/profile` is not in `navigationFor`.
  - `/profile` (`ProfilePage`): heading `Profiel`, `ProfileForm` with `useUpdateMe` and no `onDelete`. For someone with an admin role (`isPlatformAdmin` or `organizationAdminOf` not empty), a link-button `Toegangssleutels` to `/profile/passkeys`.
  - `/profile/passkeys` (`PasskeysPage`) inside `RequireAdminRole` (the not-found page otherwise, following a change of rights without a reload): `PasskeysPanel` with `usePasskeys`, `useCreatePasskey`, `useRemovePasskey` and `phoneHint`. Toasts: `De toegangssleutel is toegevoegd.` and `De toegangssleutel is verwijderd.` An unconfirmed admin who opens the page gets the modal through the list's `passkey_required`.
  - `/organizations/{id}`: `OrganizationAdminsTable` with `onResetPasskeys`, which opens the reset `ConfirmDialog` of the table at the top and calls `useResetOrganizationAdminPasskeys`. The dialog closes and the toast shows when the mutation succeeds, also when that success comes from the resend after a confirmation. Any other failure shows `apiErrorMessage(code)` in the dialog.
  - `/platform-admins`: the same with `useResetPlatformAdminPasskeys`, and `canResetPasskeys` true for everyone but the user.

- [ ] **Step 1: Write the failing tests** (`renderPortal`, `mockFetch`).

```tsx
test("the login screen of the portal has the passkey button", ...);
test("the name in the header links to /profile, which saves the name and has no account deletion", ...);
test("an admin sees Toegangssleutels on /profile; a coordinator does not, and /profile/passkeys is not found for them", ...);
test("the passkeys page lists, adds and removes, with the phone hint", ...);
test("a passkey_required on the list opens the modal; after confirming, the list shows", ...); // the ceremony mocked
test("Annuleer in the modal leaves the page's load error with Probeer opnieuw", ...);
test("resetting an admin asks first and names them; the request goes to the organization's route", ...);
test("a reset that needs a confirmation goes through after it, and the dialog closes with the toast", ...);
test("an admin without a passkey shows Nog geen toegangssleutel on both pages", ...);
test("no portal route starts with /app or /api", ...); // the existing test still passes
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and look.** `pnpm check && pnpm build`. Then `pnpm dev`, log in on the portal as `beheerder@example.test` in Chrome with a virtual authenticator (DevTools, More tools, WebAuthn). Make a passkey from Profiel, log out, and log in with it. Save screenshots to `.context/portal-passkeys-page.png` and `.context/portal-passkey-modal.png`.
- [ ] **Step 5: Commit.** `git commit -m "Add passkeys to the portal: login, profile and repairing someone"`

---

### Task 11: The app: Toegangssleutels on Profiel

**Files:**

- Create: `apps/mobile/src/auth/passkey-confirmation-host.tsx`, `apps/mobile/src/screens/more/passkeys-screen.tsx`
- Modify: `apps/mobile/src/auth/auth-gate.tsx` (mount the host where `useAccessLiveUpdates` is), `apps/mobile/src/screens/more/profile-screen.tsx`, `apps/mobile/src/router.tsx`
- Test: `apps/mobile/src/screens/more/passkeys-screen.test.tsx`, `apps/mobile/src/screens/more/profile-screen.test.tsx`, `apps/mobile/src/auth/auth-gate.test.tsx`, `apps/mobile/src/router.test.tsx`

**Interfaces:**

- Consumes: Tasks 8 and 9; `SubScreen`.
- Produces:
  - The host as in the portal, mounted once while someone is logged in.
  - Profiel shows a button `Toegangssleutels` for someone with an admin role, which opens `/more/profile/passkeys`. Nobody else sees it.
  - `/more/profile/passkeys` (`PasskeysScreen`, a `SubScreen` titled `Toegangssleutels`, back to Profiel): `PasskeysPanel` without `phoneHint`; the not-found behavior of the other sub-screens for someone without an admin role.
  - The app's login screen does not get `logInWithPasskey`.

- [ ] **Step 1: Write the failing tests.**

```tsx
test("Profiel shows Toegangssleutels for a platform admin and an organization admin, not for a coordinator or a volunteer", ...);
test("the passkeys screen lists and adds, without the phone hint", ...);
test("the app's login screen has no passkey button and no word toegangssleutel", ...);
test("a passkey_required on the passkeys screen opens the modal", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the passkeys screen to the app's profile for admins"`

---

### Task 12: End-to-end tests, the emergency procedure and the documentation

**Files:**

- Create: `e2e/helpers/passkeys.ts`, `e2e/portal-passkeys.spec.ts`, `docs/emergency-procedures.md`
- Modify: `e2e/login.spec.ts`, `AGENTS.md`, `infra/alwaysdata/README.md`, `scripts/lib/ci-jobs.ts` and its test (only if needed)

**Interfaces:**

- Produces (`e2e/helpers/passkeys.ts`): `addVirtualAuthenticator(page: Page): Promise<{ remove(): Promise<void> }>`: a CDP session (`page.context().newCDPSession(page)`), `WebAuthn.enable`, then `WebAuthn.addVirtualAuthenticator` with `{ protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true }`.

- [ ] **Step 1: Write the tests.**

```ts
test("an organization admin makes a first passkey, logs out and logs in with it", async ({
  page,
}) => {
  // createWorkingGroup(); a session as its adminAddress; a virtual authenticator.
  // Click the name in the header: Profiel; Toegangssleutels: the modal "Maak een toegangssleutel"; press it:
  // the list shows one passkey "Toegevoegd op …". Mailpit holds "Er is een toegangssleutel toegevoegd aan je account".
  // Log uit; "Log in met je toegangssleutel": Werkgroepen shows, without a code.
});
test("an admin with a passkey confirms on a code session", async ({ page }) => {
  // As above up to one passkey; log out; log in with a code (readLoginCode): Toegangssleutels opens the modal
  // "Bevestig dat jij het bent"; Gebruik je toegangssleutel: the list shows.
});
test("a platform admin repairs an organization admin who lost their passkey", async ({
  page,
  browser,
}) => {
  // The organization admin makes a passkey in a second context. A platform admin (runAdmin) makes their own passkey,
  // opens the organization: Verwijder toegangssleutels on that admin, the question names them, Verwijder: the toast,
  // and the row shows "Nog geen toegangssleutel". Mailpit: "Je toegangssleutels zijn verwijderd" to that admin.
});
// login.spec.ts (add): the app's login screen has no "Log in met je toegangssleutel".
```

- [ ] **Step 2: Run.** `pnpm test:e2e` three times. Expected: PASS each time.
- [ ] **Step 3: Write `docs/emergency-procedures.md`:** a short introduction (procedures that do not depend on the host; how to reach a database is in the host's README), then "The last platform admin lost all passkeys". First find the user by the whole address with `select id from users where email = '<adres>' and deleted_at is null;`. Then `delete from passkeys where user_id = '<id>';`, one statement in a database session on that environment's database. Then log in with a code and add a new passkey as a first one, within a day of that login. The procedure says to check the address carefully, that it writes no audit entry, and why: the database is the only way back for the last platform admin.
- [ ] **Step 4: Update `infra/alwaysdata/README.md`.** Under "Operating notes", say how to open a database session on Alwaysdata (as for the other database notes there) and link to the procedure. Under DNS, or "Rebuilding on another host", say that the relying party ID is the host name of `PUBLIC_ORIGIN`: a new domain makes every passkey useless, and admins then add new ones after a reset.
- [ ] **Step 5: Update `AGENTS.md`.**
  - Current state: passkeys exist (this pull request); admin power does not depend on them yet (pull request 2).
  - Repository layout: `docs/` holds `emergency-procedures.md`.
  - Glossary: `toegangssleutel` | `passkey` | `A key on a phone, laptop or security key that an admin uses to confirm admin power; unlocked with a fingerprint, face or PIN`.
  - Tech stack: `@better-auth/passkey` 1.7.27 next to Better Auth, and `@simplewebauthn/browser` in the apps.
  - Sessions and login: `AUTH_PATHS` holds seven routes. The two `generate-*` routes are mounted as `POST` and passed on as `GET`. The registration routes check `passkeys.add` through `decide` first. Every verify call makes a new, stamped session and deletes the old one, and answers `{ ok: true }`. Another account's passkey is refused in a confirmation. `sessions.passkey_verified_at` is set only by the session-create hook. The relying party ID and origins come from `PUBLIC_ORIGIN` and `ALLOWED_ORIGINS`. Passkeys work on `localhost`, not over `dev:https` on a LAN IP address. Only the portal's login screen has the passkey button.
  - Roles and permissions: the actor's `passkeyVerifiedAt` and `now`; `confirmationOf`, the two windows and their constants; `Decision` `confirm` and 403 `passkey_required`; `requiredConfirmation`; the five passkey permissions; reset is never for oneself (`own_account`); `deleteAccount` deletes passkeys.
  - The audit log: the three `passkey.*` actions in the group Accounts, which an organization admin's Actie offers now.
  - Mail: the kinds `passkey-added` and `passkeys-removed`.
  - Frontend: the confirmation hook and `backgroundRequestMeta`, the hosts, the portal's `/profile` and `/profile/passkeys` (not in the navigation), and the app's `/more/profile/passkeys`.
  - Tests: `stampSession`, the soft authenticator and the passkey helpers; the cast's three admins are confirmed; `addVirtualAuthenticator` for Playwright.
- [ ] **Step 6: Check the CI rules** (AGENTS.md, "CI"), then run everything: `pnpm check && pnpm build && pnpm test:e2e && pnpm test:visual:docker && pnpm release:build --allow-dirty && pnpm release:smoke`. Expected: PASS.
- [ ] **Step 7: Commit.** `git commit -m "Add end-to-end tests for passkeys, the emergency procedure and the documentation"`

## Decisions made while planning

The spec leaves these open, or this plan departs from it. The maintainer may overrule each; the task that holds it is named.

1. **The guards on the registration routes are in our Fastify route, through `decide`** (`passkeys.add`), not in Better Auth's `hooks.before`. The behavior is the design's. The refusals come in our error format (403 `not_allowed`, 403 `passkey_required`, 409 `too_many_passkeys`), so the confirmation hook recognizes `passkey_required` as everywhere else, and the windows are checked in one place (Task 6).
2. **The other-account check uses the plugin's `authentication.afterVerification`.** That option runs after the signature check and before the session is made, so no change to the package is needed (Task 6).
3. **The previous session is read and deleted by our route** around the call to Better Auth, and the forced `createSession: true` is set there too (Task 6).
4. **The `generate-*` answers keep the session account's own credential IDs** (`excludeCredentials`, `allowCredentials`): the browser needs them. The test that answers hold no credential ID applies to the verify routes. For the options it checks that they hold no other account's ID, no public key and no token (Task 6).
5. **`forwardLog` scrubs double-quoted values,** because SimpleWebAuthn's errors quote the challenge and the plugin logs them (Task 6).
6. **`pruneLoginData` also deletes expired `verifications` rows:** a registration challenge holds the account's address (Task 4).
7. **`passkeys.credential_id` is unique and `counter` is a `bigint`** (Task 1).
8. **`GET /api/passkeys` and `DELETE /api/passkeys/{id}` need an admin role,** like adding one. A former admin's leftover passkeys are removed by another admin's reset (Task 5).
9. **Removing one's own passkey does not clear the session's confirmation;** a reset by someone else does, as the design says (Task 4).
10. **`OrganizationAdmin.mayResetPasskeys`,** filled by the API, so the organization page shows the reset action only where it is allowed, without telling an organization admin who is a platform admin (Task 7).
11. **The organization route checks in this order:** own account, outsider, not an admin there, then the permission. An outsider gets 404 whatever the target (Task 7).
12. **The added-passkey mail is dropped when the passkey is gone** by the time it is sent; the removal sends its own mail. The removal mail has three texts, chosen when it is sent, and the one for "one of several" has its own subject (Task 3).
13. **The organization admin's audit filter offers Accounts,** which now holds the `passkey.reset` entries of their organization (Task 2).
14. **The portal's profile has no account deletion** (`ProfileForm` without `onDelete`): the portal already says an account is deleted in the app (Task 9).
15. **The passkey login button is on the email step** of the portal's login screen, under the email form (Task 9).
16. **The modal hook resends a failed mutation with `mutation.execute`,** and pages close their dialogs on the mutation's state, not in a `mutate` callback, so the resend's success reaches them (Tasks 8 and 10).
17. **Adding a further passkey after a confirmation takes a second tap** on `Voeg een toegangssleutel toe`: browsers open the passkey prompt only right after a tap (Task 8).
18. **The cast's three admins are stamped in this pull request;** pull request 2 adds the unconfirmed ones (Task 5).

## Deviations

Recorded while building, 26 November 2026. One line each: what, and why.

- No name listed in "What pull request 2 builds on" changed. Added beside them: `useCreatePasskey({ onCreated })`, `hasAdminRole(me)` in `packages/api-client/src/membership.ts`, `resetAdminPasskeys` in `packages/db/src/passkeys.ts`, and a reset that deletes all the person's sessions (see the last lines).
- Built on origin/main `1955537` (#39, Sentry on the server) after a rebase: `apps/api/package.json` kept both sets of dependencies, `apps/api/src/testing/login.ts` took main's logger option, the lockfile and the generated client were made again, and `system.triggerTestError` got `none` in `requiredConfirmation`.
- Rebased again on origin/main `17d753c` (#38, Sentry in the browser): the portal header has both "Meld een probleem" and the name as a link to `/profile`, the profile routes joined `buildRoutes`, and both apps' `package.json` keep `@sentry/react` and `@simplewebauthn/browser`.
- Task 3: the subject of the mail for "one of several passkeys removed" has no final period, like the other subjects.
- Task 4: `resetPasskeys` takes no lock against a passkey Better Auth inserts at the same moment; the design accepts that window for a first passkey.
- Task 6: the redaction of quoted values is a local helper inside `forwardLog` (its message and error messages), applied before `scrub`, which stays as it is in `packages/logging`: only Better Auth's lines need it, and the task asked to build on #35, not to add a second scrubber. It redacts from the first quote to the last, because pairing quotes could be defeated by a value with a quote in it.
- Task 6: `afterVerification` reads the signed cookie and `internalAdapter.findSession` itself instead of `getSessionFromCtx`, which swallows database errors, so the other-account check fails closed.
- Task 6: `apps/api/src/auth/auth-response.ts` (`clientBody`, `copyCookies`, `sendAuthResponse`) is shared by both route files; `copyCookies` keeps the last `Set-Cookie` per name.
- Task 6: a failed delete of the previous session answers 500 without a new cookie, which leaves a consistent state; a passkey row that vanished while a session is present answers `PASSKEY_OF_OTHER_ACCOUNT`, misleading but safe.
- Task 6: for the tests, `SoftAuthenticator.userVerified` is mutable, `addPasskey` takes an optional body, and `createTestApp` an optional `{ logger }`. A test also checks that a client cannot set `passkeyVerifiedAt` (carried over from Task 5).
- Task 7: `getOrganization` returns `isPlatformAdmin` per admin, and the route strips it before it answers. `routes/platform-admins.ts` did not change: `listPlatformAdmins` already fills `hasPasskey`.
- Task 7: the new `resetAdminPasskeys` locks the person's user row inside the reset's transaction and checks again that they are the admin the route authorized, and whether they are a platform admin: 404 when they are no such admin any more, 409 `membership_changed` ("Deze persoon heeft intussen een andere rol. Kijk opnieuw.") when that changed.
- Task 7: decision 10 reworded: `mayResetPasskeys` false on a fellow admin's row reveals that they are a platform admin no more than the reset route's 403 does. Kept as built, because the spec shows the action only where the API allows it.
- Task 8: a query that fails with `passkey_required` is not retried and not refetched on window focus, so Annuleer leaves the page with its usual error. A live-event refetch after Annuleer can open the modal again; that is for pull request 2 (see "What pull request 2 builds on").
- Task 8: `useCreatePasskey` also reopens the event stream; the confirmation store is made per query client when first needed (a `WeakMap`); me turning null cancels the confirmation; `reportPasskeyRequired` and `cancelPasskeyConfirmation` are exported too.
- Task 9: the `PasskeyModal` stories use the Modal story layout (390×800), not `visualViewport`; both admin tables have a `WithReset` story; the menu column of `OrganizationAdminsTable` shows with `canRemove` or `onResetPasskeys`.
- Task 10: `useCreatePasskey({ onCreated })` gives the success signal for the toast, and the passkeys page also shows the toast when `me.user.hasPasskey` turns true, so a first passkey made in the modal gets one too.
- Task 10: `ProfileForm` and `PasskeysPanel` take `headingLevel` (the portal passes 1); `nameOrAddress` is shared in `packages/ui`; a hook `use-on-success.ts`; the header link keeps `aria-label` "Profiel", as the plan says. No screenshots were made in step 4: the Playwright tests of Task 12 cover the flow.
- Task 11: `hasAdminRole(me)` moved to `packages/api-client/src/membership.ts`, so the app and the portal share it. The app shows results inline (`role="status"`), because it has no toaster; a non-admin on `/more/profile/passkeys` sees `apiErrorMessage("not_allowed")`, as on the other sub-screens.
- Task 12: the organization admin's Actie list in `e2e/portal-audit-log-and-accounts.spec.ts` now ends with Accounts; the passkey packages have their own row in the tech stack of `AGENTS.md`; the README's database session command starts `psql` from `node --env-file` with only `PG*` variables, so the password is not in the command line.
- Final review: database errors no longer reach the log or Sentry with their values. Drizzle 1.0.0-rc.6 puts parameters in a message only with `paramsInErrors`, but the query text and PostgreSQL's own messages leaked; `withoutDatabaseValues` in `packages/logging` copies such an error with a fixed message, used by `serializeError`, a pino `logMethod` hook and `forwardLog`.
- Final review: the confirmation modal refetches me when its ceremony was chosen from a stale `hasPasskey`; the passkey login button is disabled, not pending, while "Stuur code" pends (`passkeyPending` on `EmailForm`); each passkey's Verwijder button is named by the date it was added; "What pull request 2 builds on" says what it must do with `backgroundRequestMeta`.
- Final review, decided by the maintainer: a reset by someone else deletes all the person's sessions, so they are logged out on every device and log in again with a code. Decision 9 and the design said it clears the confirmation of the sessions, but every ceremony makes a new session, so a confirmed session is always young enough for Better Auth's first-passkey rule (`freshAge`), and a stolen laptop could add a first passkey of its own after every reset. The reset sends `access-changed` for the person, as `deleteAccount` does, so their open apps show the login screen; it returns `{ removed, sessionsEnded }`.
- With it: the reset writes `passkey.reset` and queues `passkeys-removed` when it removed a passkey or ended a session, because a logout always leaves a trace (the plan said only when a passkey was removed); the reset question ends with "{naam} moet daarna overal opnieuw inloggen."; step 4 of `docs/emergency-procedures.md` offers only deleting the sessions.
- Accepted, not changed: two registrations at the same moment can reach eleven passkeys (the cap takes no lock; it is a soft cap). A failure of `recordPasskeyAdded` loses the entry and the mail, logged at `error`, as the plan says. The test that a client cannot set `passkeyVerifiedAt` accepts 200 or 400 for the code login; the check on the row carries it. A reset of an organization admin reads their admin row without `lockOrganization`, a harmless race. Two failed mutations from a double tap are both resent, so pages disable their buttons while pending. `logInAgain` closes the modal even when signing out fails; the refetch of me keeps the gate truthful. No test that `/profile/passkeys` turns into the not-found page on `access-changed`, and none of a resend on `/platform-admins`. The toast check in `e2e/portal-passkeys.spec.ts` may be slow on CI (Sonner shows it about 4 seconds). The `passkeys-removed` mail does not say that the person was logged out, and a reset that only ended sessions sends it too. Sentry's database spans may carry PostgreSQL messages in their status (a follow-up).
- 27 November 2026, by the maintainer: nobody logs in with a passkey. The portal's "Log in met je toegangssleutel" button, its `onPasskey` props, test, story and screenshot are gone; both authentication routes answer 401 `not_logged_in` without a session and `afterVerification` refuses without one (401 `SESSION_REQUIRED`, also when the session ends in between); `unknown_passkey` now only shows in the confirmation modal ("Probeer het nog eens."). A passkey only confirms an existing session. No name in "What pull request 2 builds on" changes; only there is no passkey login.
