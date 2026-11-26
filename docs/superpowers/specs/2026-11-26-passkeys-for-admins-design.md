# A stronger login for admins: passkeys

Date: 26 November 2026. Status: approved by the maintainer on 26 November 2026.

## Intent

The project plan owes "sterke beheerdersauthenticatie" (section 12, Privacy). Today everyone logs in the same way: a code by mail, then a session of 180 days that renews itself on every day of use. Whoever reads an admin's mailbox, or finds an admin's portal still open on a laptop, is that admin. Since part 2 of slice 1 the portal carries real power: a platform admin deletes accounts and appoints platform admins, an organization admin sees the name, email address and phone number of everyone in the organization and appoints coordinators.

What the maintainer wants to protect against: someone breaking into the account of a platform admin or an organization admin and then reading people's personal data, deleting data of any kind, or making a mess (renaming, handing out roles, switching working groups off). This design makes admin power depend on a passkey, so that a mailbox alone, or a session left open for more than a day, no longer gives it. Everything a coordinator or a volunteer does stays as it is.

A **passkey** ("toegangssleutel", the word Apple and Google use in Dutch) is a key pair that a phone, a laptop or a security key makes for one website. The private key never leaves the device (or the person's iCloud Keychain or Google Password Manager, which sync it end to end); the device unlocks it with a fingerprint, the face or the screen lock PIN. A website cannot be tricked into receiving it, so it cannot be phished, and it does not depend on the mailbox.

## Goals

- Admin power (everything a platform admin or an organization admin may do beyond what they are besides) needs a passkey used in the last 24 hours, in that session.
- A few actions that cannot be undone need a passkey used in the last 10 minutes.
- The passkey is asked for at the moment it is needed, in the portal and in the app, with one modal and one tap; the request then simply goes through.
- An admin can log in with a passkey directly, without a mail code.
- An admin adds their first passkey without help; a lost passkey is repaired by another admin in the portal.
- Volunteers and coordinators notice nothing.

## Non-goals

- Coordinators. There are many, they work in the phone app, and each reaches only their own group (decided with the maintainer on 26 November 2026).
- Passwords (still "no passwords, ever"), authenticator app codes (TOTP), SMS codes.
- Passkeys for volunteers and coordinators who are not admins.
- Logging in to the app with a passkey for everyday use. The app's login screen does not change.
- Listing or ending one's other sessions ("log out everywhere").
- A command in `pnpm admin` for passkeys (the maintainer: "UI is fine").

## Anti-goals

What would make this a failure even if it works:

- Someone who controls an admin's mailbox gets admin power without the admin's device, once the admin has a passkey.
- A session left open, on a shared laptop or a lost phone, keeps admin power for longer than a day.
- A volunteer or coordinator meets a new step, a new button or a new word.
- A control only hidden in a client while the API would accept the request without a passkey.
- A switch (environment variable, header, query parameter) that turns the passkey requirement off. Tests stamp sessions through a test helper, never through a setting the release reads.
- An admin is locked out with no way back except database work, other than the last platform admin of an environment.
- Passkey material (public keys, credential IDs, challenges) in logs, mails or the audit log.

## Constraints

All of AGENTS.md applies. The ones that shape this work most:

- Better Auth is mounted as an allowlist (`AUTH_PATHS` in `apps/api/src/auth/auth-routes.ts`). Every route added there bypasses our Zod contract and must be added deliberately.
- Who is logged in comes from `GET /api/me`; routes reach the user only through `request.actor` and decide only through `authorize` and `decide` (`apps/api/src/permissions/rules.ts`).
- 401 without a login, 404 for what the actor may not see at all, 403 for what they may see but not change.
- A `GET` never changes state; state-changing requests from a foreign `Origin` are refused.
- The API is backward compatible: only add fields. An open app keeps running old code.
- The audit log never holds a name, an email address or a phone number.
- Everything a user reads is Dutch, with "je", in sentence case.

## Approaches

Decided with the maintainer on 26 November 2026.

**Who gets the stronger login.** Platform admins and organization admins (chosen). Coordinators were left out: they are many, work on the phone, and reach only one group.

**What the stronger login is.** Considered:

1. _A passkey_ (chosen). No mailbox involved, cannot be phished, unlocked with what the phone or laptop already uses. Better Auth has a passkey package for our exact version.
2. _A second factor after the mail code_ (an authenticator app, backup codes). Better Auth's two-factor plugin only steps in after a password login (`/sign-in/email`, `/sign-in/username`, `/sign-in/phone-number` in `better-auth@1.7.27`), not after our code login, and enabling it without a password needs a special option. More typing for the admin, and a code can be phished. Dropped.
3. _A second code to the same mailbox._ Not a second factor. Dropped.

**Where the passkey is asked for.** Considered:

1. _Admin power comes from the session, not from the account_ (chosen). A mail code still logs anyone in; in that session someone is only what they are besides admin (coordinator, volunteer, or nothing). A passkey, at login or as a confirmation later, gives the full rights for 24 hours from the last passkey; then the session falls back instead of ending. The app stays as it is for admins who also count animals.
2. _Admin accounts log in only with a passkey, everywhere, with sessions of a day._ A simpler rule, but an admin who walks a transect at night logs in on the phone every evening, and a lost phone locks them out of everything. Rejected.

The prompt appears at the moment it is needed (the maintainer's idea), not as a separate screen in advance.

**The first passkey.** Considered:

1. _Added from a session that began with a mail code, as long as the account has none_ (chosen). The weak window, between becoming an admin and adding the first passkey, is accepted.
2. _A setup code that another admin makes and passes on outside the mail._ Closes the window, at the cost of a hand-over for every new admin. Rejected as not worth it.

**Recovery.** Another admin removes all of someone's passkeys in the portal; the person then adds a new one as under the first passkey (chosen, consistent with the choice above). The last platform admin of an environment who loses all passkeys is repaired by a database statement, written down in a new `docs/emergency-procedures.md` (see "The last platform admin").

**How to build it.** Considered:

1. _Better Auth's passkey package `@better-auth/passkey@1.7.27` behind the allowlist_ (chosen). The WebAuthn checks (challenges, origins, the signature counter) are SimpleWebAuthn's, written and tested by others, the same reason part 1 chose Better Auth for logging in. A confirmation is a passkey login that replaces the session.
2. _Our own endpoints on SimpleWebAuthn._ Everything under our contract, and a confirmation could update the session row in place, but we would write and maintain the security-sensitive parts ourselves. Rejected for the same reason part 1 rejected its own login code.

## Design

### Who counts as an admin here

An actor with `isPlatformAdmin` or with at least one organization admin row. "Admin power" is everything `decide` allows only because of the relation `platformAdmin` or `organizationAdmin`, and every list whose scope grows through those relations.

### The confirmation and its two windows

- A session has a new column, `sessions.passkey_verified_at` (`timestamptz`, null by default): the moment a passkey was last used for it.
- **Confirmed:** `passkey_verified_at` is less than 24 hours ago. A confirmed admin has all their rights, as today.
- **Recently confirmed:** less than 10 minutes ago. Needed for the actions in "Actions that cannot be undone".
- **Unconfirmed:** null or older. The actor is treated as if they had no admin roles, except that where those roles would have allowed more, the API answers 403 with the new code `passkey_required` instead of the answer for the person without the roles.
- The 24 hours run from the last passkey, not from the last request; using the app or the portal does not extend them. When they run out the session stays: it falls back to the person's other roles, and the next admin request asks for the passkey again. The session itself keeps its 180 days and its daily renewal.
- The two durations are constants in the API (`ADMIN_PASSKEY_CONFIRMATION_WINDOW` for the 24 hours, `ADMIN_PASSKEY_RECENT_CONFIRMATION_WINDOW` for the 10 minutes), not settings in the portal: they are security rules, not content.

### How the API enforces it

- **The actor** (`apps/api/src/permissions/actor.ts`) carries the session's `passkeyVerifiedAt` and the moment the request is handled, so `decide` can tell confirmed, recently confirmed and unconfirmed apart. `loadActor` and `requireActor` read it with the session.
- **`decide`** gets a fourth outcome, for example `confirm` (and `authorize` throws 403 `passkey_required` for it). The rule, in one place: compute the decision with the actor's full roles; if it is `allowed` only because of an admin relation and the session is not confirmed, compute it again with the admin roles taken away; if that is `allowed` (the admin is also the group's coordinator), the answer is `allowed`, otherwise `confirm`. For the actions that need a recent confirmation the same happens with the 10-minute window. A route never checks the windows itself.
- **Lists whose scope grows through admin roles** answer 403 `passkey_required` to an actor who has an admin role and is unconfirmed, before reading anything: `GET /api/managed-working-groups`, `GET /api/organizations`, `GET /api/organizations/{id}`, `GET /api/membership-requests` (the portal's list), `GET /api/audit-log-entries`, `GET /api/platform-admins` and `POST /api/users/lookup`. A coordinator who is also an organization admin therefore confirms once to use the portal; in the app, which uses the per-group endpoints, their own group keeps working through `decide`.
- **A field that depends on a role** is decided the same way, but without a 403: where a route asks `decide` whether to include a field, `confirm` counts as "not allowed" and the field is left out, as for anyone without the role. The response then says so: it carries `passkeyReveals`, the names of the fields a confirmation would add (absent when there are none), so the client can show that something is hidden and offer to confirm. The two current cases:
  - `GET /api/working-groups/{id}/members` (`workingGroup.viewMemberContact`): `email`, `phone` and `hasLoggedIn` are left out of every member; the response carries `passkeyReveals: ["email", "phone", "hasLoggedIn"]`. This happens to an organization admin who is a volunteer of the group, or no member of it.
  - `GET /api/health` (`system.viewDatabaseDetails`): stays public and never answers `passkey_required`; an unconfirmed platform admin gets `detailsHidden: true` as anyone else, plus `passkeyReveals: ["database"]`.

  A later field that depends on an admin role follows the same rule.

- **The event stream** delivers by the actor's effective roles: an unconfirmed admin receives only what their other roles would. The stream already reloads its actor at least every 5 minutes, so a lapsed confirmation takes effect within that time.
- **`GET /api/me`** keeps reporting every role (`isPlatformAdmin`, `organizationAdminOf`), so the navigation still shows the admin pages, and adds two fields: `user.hasPasskey` (boolean) and `adminConfirmedUntil` (ISO 8601 with offset, or null when the session is not confirmed or the person has no admin role). Both are additions, so an open old app keeps working.
- **New error code** `passkey_required` in `apiErrorCodes`, listed in the `errorResponses` of every route that can answer it.

### Actions that cannot be undone

These need a passkey used in the last 10 minutes, also inside the 24 hours, so that a forgotten open laptop cannot be used for the worst things:

- deleting someone else's account (`DELETE /api/users/{userId}`);
- appointing or removing a platform admin (`POST /api/platform-admins`, `DELETE /api/platform-admins/{userId}`);
- appointing or removing an organization admin (`POST /api/organizations/{id}/admins`, `DELETE /api/organizations/{id}/admins/{userId}`), and creating an organization, which appoints its first admin (`POST /api/organizations`);
- removing someone else's passkeys;
- adding a second or further passkey, and removing one of one's own.

A new admin action in a later slice falls under the 24-hour rule by itself, through `decide`. Whether it also belongs in this list (a drain import that replaces drains, for example) is decided with that feature.

### Passkeys

- **Who may have one:** an account with an admin role. Adding one without such a role is refused (403 `not_allowed`). A passkey stays when the role is taken away; it then gives nothing beyond a login.
- **The first passkey** is added from any session of the account, also one that began with a mail code, while the account has no passkey. Better Auth also requires that session to be at most a day old (`freshSessionMiddleware`, `session.freshAge`, default one day); we keep that default as a small extra safeguard, so an admin with an older session logs in again with a code before adding the first passkey.
- **A further passkey** needs a recent confirmation (10 minutes). At most 10 passkeys per account.
- **Adding a passkey confirms the session.** Better Auth's registration takes `createSession: true` in the request body, which makes a new session; our route forces it on whatever the client sends, and the same hook that stamps a passkey login stamps it (see "Better Auth"). The admin taps once, not twice.
- **A passkey for the phone, made on the laptop.** An admin whose laptop passkey does not reach their phone (Windows Hello with an iPhone, for example) adds one for the phone on the portal's passkeys screen: the browser's own dialog offers to store it on a phone through a QR code. The portal's screen says so in one line under the button: "Wil je ook op je telefoon beheren? Kies dan in het venster voor je telefoon." Adding a further passkey in the app itself needs a recent confirmation, which a phone without a passkey cannot give; the QR code on the laptop is the way for that phone.
- **Settings:** user verification `required` (always a fingerprint, face or PIN), resident key `required` (so login works without typing an address), attestation none, the relying party ID the host name of `PUBLIC_ORIGIN` (`padvinder.net`, `staging.padvinder.net`, `localhost`), the name "PadVinder". Any passkey the browser offers counts, also a security key.
- **Removing someone's passkeys** deletes all of them and clears `passkey_verified_at` on all that person's sessions, so a stolen laptop with a confirmed session loses admin power at once. Who may: a platform admin for anyone; an organization admin for a fellow admin of an organization they administer, unless that person is a platform admin (otherwise an organization admin plus someone with the platform admin's mailbox could take over the platform). A new permission action in `decide`, recently confirmed. Removing one's own passkeys goes through the passkeys screen, one at a time.
- **Account deletion** (`deleteAccount`) deletes the person's passkeys too.

### Better Auth

- Add `@better-auth/passkey@1.7.27` (exact, same as `better-auth`), and the `passkeys` table as Better Auth's schema describes (`name`, `public_key`, `user_id`, `credential_id`, `counter`, `device_type`, `backed_up`, `transports`, `created_at`, `aaguid`), in `packages/db` with Drizzle, plural snake_case like `sessions`.
- **Four routes join the allowlist:** `/passkey/generate-register-options`, `/passkey/verify-registration`, `/passkey/generate-authenticate-options`, `/passkey/verify-authentication`. The two `generate-*` routes are `GET` in Better Auth but store a challenge and set a cookie; we mount them as `POST` on our side and pass them on as `GET`, so the Origin check covers them and "a `GET` never changes state" holds. Better Auth's `list-user-passkeys`, `delete-passkey` and `update-passkey` stay unmounted: our own endpoints under the contract do that.
- **Guards** in `hooks.before` on the two registration routes: the account has an admin role; it has no passkey, or the session is recently confirmed; fewer than 10 passkeys.
- **Stamping:** `databaseHooks.session.create.before` receives the endpoint context; for a session made by `/passkey/verify-authentication` or by `/passkey/verify-registration` it sets `passkey_verified_at` to now. The existing `after` hook sets `last_login_at` as before.
- **A confirmation replaces the session.** When `/passkey/verify-authentication` or `/passkey/verify-registration` comes with a session cookie, the old session is deleted after the new one is made (Better Auth leaves it in place for both). When the passkey belongs to another account than the session's (someone else's passkey on a shared laptop), the confirmation is refused, no session is made, and the old session stays; a login without a session (the login screen) accepts any account's passkey. Better Auth narrows the browser's choice to the session's passkeys only when that account has one (`allowCredentials`) and never compares the user at verification, so the check on the server is ours and is the only one.
- **The answers carry no secrets.** Both verify routes answer with a nested `session` (with its token) and the registration answer with the passkey's public key and credential ID. `clientBody` in `auth-routes.ts` strips only a top-level `token`; for the four passkey routes our route answers only what the client needs (the options of the two `generate-*` routes as they are; `{ ok: true }` for the two verify routes) and drops the rest.
- **Rate limits per IP address** for the four routes, in `customRules` next to the code routes, in the style of `IP_LIMITS`.
- **Log lines** go through `forwardLog` as today; no credential ID, public key or challenge in a log line.

### Our own endpoints

- `GET /api/passkeys`: one's own passkeys: `id`, `createdAt`, `backedUp` (whether it syncs). An actor with an admin role; confirmed.
- `DELETE /api/passkeys/{passkeyId}`: removes one of one's own; recently confirmed. Removing the last one is allowed; the account is then back to "no passkey".
- `DELETE /api/organizations/{id}/admins/{userId}/passkeys`: removes all passkeys of an admin of that organization; recently confirmed; for that organization's admins and platform admins (404 for an outsider to the organization or someone who is not its admin; 403 for an organization admin when the person is a platform admin). The organization in the path is the one the audit entry is for, so the organization's admins see it in Logboek.
- `DELETE /api/platform-admins/{userId}/passkeys`: removes all passkeys of a platform admin; recently confirmed; platform admins only. Its audit entry has no organization.
- Neither is for oneself (409 `own_account`, as for account deletion): one's own go through the passkeys screen.
- `hasPasskey` (boolean) is added to each admin in `GET /api/organizations/{id}` and to each platform admin in `GET /api/platform-admins`, so the page can show who still needs one.

### Audit log and mails

- **Audit actions** `passkey.added`, `passkey.removed` (one's own) and `passkey.reset` (someone else's, all of them), with the person whose passkeys they are as subject, the one who did it as actor (as in every entry), and no details. A `passkey.reset` through an organization's path has that organization; one through `/api/platform-admins` and the own additions and removals have none, so only platform admins read them.
- **When an entry is written.** Removals are ours, so their entries go in the same transaction. A passkey is added by Better Auth, which inserts the row itself, outside our transaction and without a database hook; its entry and its mail are written by our route right after Better Auth answers success. If the API dies in between, the entry is missing, but the `passkeys` row itself keeps who and when (`user_id`, `created_at`), so the trace is not lost. We do not take over Better Auth's insert for this. Their sentences go in `packages/ui/src/lib/audit-log.ts`; the prefix `passkey.` falls into the filter group Accounts.
- **Mails** to the person, after every passkey added and after removal of their passkeys by themselves or by someone else. Someone who took over the mailbox reads them too, but the real admin sees them as well, and nothing else would tell them. Kinds `passkey-added` and `passkeys-removed`, through the mail queue (IDs only, `loadMailJobData` answers null for a deleted account), queued in the transaction of the change where we own it, and for an addition with its audit entry as above.
- Texts (sentence case, "je"; the greeting as every mail):
  - Subject "Er is een toegangssleutel toegevoegd aan je account". Body: "Er is op {datum} om {tijd} een toegangssleutel toegevoegd aan je PadVinder-account. Deed je dat zelf? Dan hoef je niets te doen. Deed je het niet? Neem dan meteen contact op met een hoofdbeheerder of met een andere beheerder van je organisatie."
  - Subject "Je toegangssleutels zijn verwijderd". Body when someone else did it: "{naam} heeft je toegangssleutels voor PadVinder verwijderd. Je maakt een nieuwe de volgende keer dat je iets beheert in PadVinder." When the person removed their own last one, the mail says so without a name. When one of several was removed: "Er is een toegangssleutel verwijderd van je account." with the same advice as above.

### The clients

- **One modal, shared** (`packages/ui`, with stories), and one hook in `packages/api-client` that catches `passkey_required` from any query or mutation of a screen the person opened or a button they pressed, shows the modal once (several failing requests at once share it), and after success refetches or resends what failed. A background request (a badge in the navigation, a count in the app's Meer menu) does not open the modal; it leaves out what it could not load.
- **The modal** has a button rather than opening the system prompt itself: browsers, Safari especially, open the passkey prompt only right after a tap. With a passkey:

  ```
  Bevestig dat jij het bent

  Voor beheer vraagt PadVinder om je toegangssleutel.

  [ Gebruik je toegangssleutel ]
                        Annuleer
  ```

  Without one (`user.hasPasskey` false):

  ```
  Maak een toegangssleutel

  Voor beheer heb je een toegangssleutel nodig. Je telefoon of
  laptop bewaart hem en vraagt om je vingerafdruk, gezicht of
  pincode. Je maakt hem één keer.

  [ Maak een toegangssleutel ]
                        Annuleer
  ```

  Failures, in the modal: cancelled or failed "Dat lukte niet. Probeer het nog eens."; a passkey of another account "Deze toegangssleutel hoort bij een ander account."; a session too old for a first passkey "Log eerst opnieuw in met een code uit je mail. Daarna maak je een toegangssleutel." with a button "Log opnieuw in" (logs out); a browser without passkeys "Deze browser kan geen toegangssleutel gebruiken. Gebruik een recente versie van Chrome, Safari, Edge of Firefox." Annuleer closes the modal; the page shows its usual load error, the button its usual failure.

- **What is hidden shows as hidden.** Where an unconfirmed admin sees less than a confirmation would show, the screen says so instead of leaving it out silently: a grey bar in the place of what is hidden, with an eye button next to it (`aria-label` "Toon met je toegangssleutel") that opens the modal; after a confirmation the screen loads again and the bar is replaced by what it hid. One shared component in `packages/ui`, with stories. It is used:
  - for each field in `passkeyReveals` (the email address and phone number of each member; the database details on the system status);
  - for the working groups of administered organizations in the app (below).
- **The app's lists follow the fallback.** `reviewableWorkingGroups` and `memberListWorkingGroups` (`packages/api-client/src/membership.ts`) load the groups of administered organizations only while `adminConfirmedUntil` lies in the future. An unconfirmed organization admin sees the requests and members of the groups they coordinate or belong to as anyone with that role does, without a modal. Each group of an administered organization that is not loaded shows as its name (the working group list is public to every logged-in user) with the grey bar and the eye button under it. A confirmed admin sees all, as today. A request opened by its address (the link in a mail) is a screen the person opened: there the modal shows when the request needs admin power.
- **After a confirmation** the client invalidates the me query and reopens the event stream (the old session is gone).
- **The portal's login screen** gets a second button under the code form, "Log in met je toegangssleutel". The app's login screen does not change: volunteers never see the word. `AuthGateView` gets an option to show it; the portal passes it.
- **Managing one's own passkeys** is reached from the profile, not from the navigation. One shared screen (`packages/ui`, with stories): the own passkeys with the date added and "Synchroniseert met je andere apparaten" where `backedUp`, a button "Voeg een toegangssleutel toe" and per row "Verwijder" (a `ConfirmDialog`).
  - In the app, Profiel gets a button "Toegangssleutels" for someone with an admin role, which opens the screen at `/more/profile/passkeys`.
  - The portal has no profile page yet. The name in its header becomes a link to a new page `/profile` (Profiel) with the same profile form as the app (`ProfileForm` in `packages/ui`) and, for someone with an admin role, the button "Toegangssleutels", which opens the screen at `/profile/passkeys`. The page is not in the navigation.
- **Repairing someone else:** on `/organizations/{id}`, each admin row shows "Nog geen toegangssleutel" where `hasPasskey` is false and has a row action "Verwijder toegangssleutels" (a `ConfirmDialog`: "Toegangssleutels van {naam} verwijderen?", "Doe dit als {naam} geen toegangssleutel meer heeft, bijvoorbeeld na het kwijtraken van een telefoon. Daarna maakt {naam} een nieuwe bij de volgende keer beheren.", buttons "Verwijder" and "Annuleer"); the same on `/platform-admins` for platform admins. Shown only where the API allows it.
- **`/system`** shows an unconfirmed platform admin the status with the grey bar and the eye button in the place of the database details.

### Data model

| Change                         | Detail                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| New table `passkeys`           | As Better Auth's passkey schema, plural snake_case, `user_id` referencing `users` on delete cascade |
| `sessions.passkey_verified_at` | `timestamptz`, nullable. Existing sessions start unconfirmed                                        |

### The last platform admin

A new `docs/emergency-procedures.md` holds the procedures that do not depend on the host, starting with this one: when the only platform admin of an environment has lost all passkeys, the maintainer opens a database session on that environment's database and deletes that person's rows in `passkeys` with one statement (by user ID, found by address), then logs in with a code and adds a new passkey as a first one. How to reach the database stays host-specific: "Operating notes" in `infra/alwaysdata/README.md` says how on Alwaysdata and links to the procedure, and AGENTS.md lists the new file in "Repository layout".

### Glossary

Add to AGENTS.md: toegangssleutel, `passkey`, "A key on a phone, laptop or security key that an admin uses to confirm admin power; unlocked with a fingerprint, face or PIN".

### Tests

As AGENTS.md requires. The parts that need care:

- **The cast** gets the admins in both states: `platformAdmin` and `organizationAdmin` with a confirmed session (as most tests need), and `platformAdminUnconfirmed` and `organizationAdminUnconfirmed` (or one more state per member, the builder's choice), so every `expectStatuses` names what an unconfirmed admin gets. A test helper stamps `passkey_verified_at` in the test database; the release has no way to do that.
- **`decide`:** every admin action answers `confirm` without a confirmation, `allowed` with one, `allowed` without one where the admin is also the group's coordinator, and the actions that cannot be undone need the 10 minutes. The windows are tested at their edges with an injected clock.
- **Lists:** each listed endpoint answers `passkey_required` to an unconfirmed admin and reads nothing.
- **The real passkey flow** against Better Auth with a software authenticator (made in the test with Node's `crypto`, or a small library): add a first passkey from a code session; a second one refused without and allowed with a recent confirmation; refused without an admin role; login with a passkey stamps the session; a confirmation and an addition each replace the session and delete the old one, also when the client sends `createSession: false`; no answer of the four routes holds a session token, a public key or a credential ID (checked on the raw body); another account's passkey in a confirmation is refused and leaves the session; the two `generate-*` routes refuse `GET` and a foreign `Origin`.
- **Removal:** removing someone's passkeys clears the confirmation of all their sessions; an organization admin cannot repair a platform admin; account deletion deletes passkeys.
- **Audit and mails:** entries and queued mails for add, remove and reset, without names or addresses in the entries and IDs only in the jobs.
- **Event stream:** an unconfirmed organization admin does not receive an event for a group they do not coordinate.
- **Fields:** an unconfirmed organization admin who is a volunteer of a group gets its members without `email`, `phone` and `hasLoggedIn` keys (raw JSON), with `passkeyReveals`, and no `passkey_required`; a confirmed one gets the keys and no `passkeyReveals`; a volunteer who is no admin gets neither the keys nor `passkeyReveals`.
- **The app's lists:** an unconfirmed organization admin who coordinates one group sees that group's requests in the app without a modal, and the other groups of the organization as names with the grey bar; the eye button confirms and loads them.
- **Playwright,** with Chromium's virtual authenticator (`WebAuthn.addVirtualAuthenticator` over CDP): an organization admin logs in with a code, opens Werkgroepen, makes a passkey in the modal and sees the page; logs out and logs in with the passkey button; a platform admin deletes an account after confirming again; a volunteer's login screen has no passkey button.
- **Stories** for the modal's states, the passkeys screen, the grey bar with its eye button, and the admin rows with and without a passkey.

## Order of work

Two pull requests, so admins can add passkeys before admin power depends on them:

1. **Passkeys exist.** The table and column, the package and the four routes, the guards and the stamping, the windows on the actor, `decide`'s new outcome and `passkey_required`, the modal and its hook, the passkey endpoints (already behind their own windows: the passkeys screen and repairing need a confirmation from the start), `hasPasskey` and the me fields, the passkeys screen with its buttons on both profiles and the portal's profile page, the login button, repairing someone else, audit entries, mails, the emergency procedure. Every other admin action works as today.
2. **Admin power needs them.** Every other admin action through `decide`, the lists, the field rule with `passkeyReveals` and the grey bar, the event stream, the app's lists, the remaining 10-minute actions, the cast's unconfirmed members, `/system`.

## Left to the builder

- File, module and component names, exact field names within the behavior above, and how `decide`'s new outcome is named.
- The software authenticator for the API tests.
- How the modal hook tells a screen's requests from background ones.
- Remaining small Dutch texts, in the style of AGENTS.md, and the sentences for the three audit actions.

## Touches other designs

- **The drain register** (`drain-register-design`): its admin actions fall under the 24-hour rule by themselves; which of them also need the 10 minutes (an import that replaces drains, for example) is decided there.
- **Logging and monitoring** (`monitoring-design`): whether failed passkey confirmations or repairs should raise an alert is theirs to decide.

## Open questions

None that block planning.
