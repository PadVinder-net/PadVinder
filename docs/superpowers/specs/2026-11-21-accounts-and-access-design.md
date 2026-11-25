# Accounts and access (slice 1, part 1)

Date: 21 November 2026. Status: approved by the maintainer on 22 November 2026.

## Intent

Slice 1 of the project plan ("Fundament") is too large for one design. It is split into four, agreed with the maintainer on 21 November 2026:

1. **Accounts and access** (this document).
2. Administration in the portal: organizations, working groups, users and roles, species.
3. Push notifications.
4. Export and backup.

Transects moved out of slice 1. They need the map and line drawing, and are designed with drains and drain routes in slice 3.

This part comes first because every later slice sits behind it: nobody can register a drain check before the system knows who they are, which working group they belong to and what they may do. It also adds the patterns the skeleton left open and that agents will copy from here on: a write that can be resent safely, a permission check, an audit log entry, an error response, and a live event that only reaches the people who may see it.

The deadline is unchanged: v1 (drains) works on real phones in January 2027.

## Goals

- A person logs in with a one-time code by email, in the mobile app and in the portal, with one account for both.
- A new volunteer creates an account, asks to join a working group, and waits; a coordinator approves or rejects the request in the app.
- Four roles (volunteer, coordinator, organization admin, platform admin) decide what a user may do, enforced on the server by one permission module.
- Organizations are strictly separated. A user can belong to working groups in more than one organization.
- A user can change their name and phone number, and delete their own account.
- An audit log records decisions and changes that one person makes about another person or about shared data.
- The skeleton's follow-ups for slice 1 are done: a shared error format, the first idempotent write, seed data, a live event stream that needs a login and filters by audience, and health details limited to platform admins.
- Login mail works locally without a real mail service, and end-to-end tests read the code from a caught mail.

## Non-goals

- No screens for managing organizations, working groups, users or roles. They come with part 2 (portal). Until then a command-line tool does this.
- No push notifications (part 3). Coordinators get an email instead.
- No changing of the email address, no joining a second working group in the app, no leaving a working group by yourself.
- No view mode (slice 6), no WhatsApp link (slice 5), no safety test (slice 2).
- No screen to read the audit log (part 2).
- No stronger login for admins yet. The plan still owes it; Better Auth has plugins for it.
- No passwords, ever.

## Anti-goals

What would make this a failure even if it works:

- A user of one organization can read or change anything of another organization, through any endpoint or the live event stream.
- A volunteer's email address or phone number reaches someone who may not see it, including through a response field the screen does not show.
- A fixed login code, a switch that skips the code check, or any other back door, in any environment.
- A membership request that is stored twice, or a second notification mail, because the app resent it.
- Permission checks written inside each route by hand, so the next agent copies a route and forgets one.
- Personal data in the audit log, in server logs or in the repository.
- An older volunteer who cannot get in: codes that expire while they look for the mail, or a resend that makes the first mail useless.

## Constraints

All of AGENTS.md applies. The ones that shape this work most:

- One origin per environment (`padvinder.net`, `staging.padvinder.net`), with the app under `/app/` and the API under `/api/`. The session cookie needs no `Domain`.
- The session cookie is `HttpOnly`, `Secure` and `SameSite=Lax`. A `GET` never changes state. State-changing requests from a foreign `Origin` are rejected (the skeleton's hook already does this for every route).
- Login codes are valid for 15 to 30 minutes and appear in the subject line of the mail. Sessions are long-lived. Requesting and verifying codes is rate-limited per email address and per IP address.
- Minimal personal data: name, email (required), phone (optional, not verified). Children have no accounts.
- Zod schemas in `packages/contracts` are the only source of the API contract. Better Auth's own routes are the one exception (see "Login").
- A write from the app that may be resent carries a client-generated UUIDv7 as its primary key.
- Dutch copy with "je"; English code, paths and tables; glossary terms exactly.
- The repository is public: seed data and fixtures are made up, and use the reserved domain `example.test`.
- PostgreSQL 18 locally and on Alwaysdata, so the built-in `uuidv7()` function is available.

## Approaches

Decided with the maintainer on 21 November 2026.

**Login: a library or our own code.** Considered:

1. _Better Auth as a library inside our API_ (chosen; the project plan already chose it on 19 November). It makes and checks the codes, creates accounts and sessions, sets the cookie and limits the request rate. It runs in our process and stores everything in our PostgreSQL. The security-sensitive code is written and tested by others, and the stronger login for admins that the plan still owes exists as a plugin.
2. _Our own login code._ A few hundred lines and two tables, in exactly our shape and under our one contract. Rejected: a mistake in session handling is the most damaging kind of bug in a public repository that holds volunteers' contact details.

**How the apps reach login.** Considered:

1. _Better Auth's own routes under `/api/auth/*` and its browser client_ (chosen), for requesting a code, checking it and logging out. Everything else goes through our own contract.
2. _Our own endpoints wrapped around Better Auth's server functions._ One client everywhere, but Better Auth's rate limiting does not cover calls made from server code, so we would rebuild it and keep the wrapper in step with every upgrade.

**Where organizations, working groups and memberships live.** Considered:

1. _Our own tables and endpoints_ (chosen). They fit requests with approval, coordinators per working group and membership across organizations, and they go through our contract, permission module and audit log.
2. _Better Auth's organization plugin._ Less code at first. Rejected: it works with invitations instead of requests, has roles per organization only, and keeps a "current organization" in the session, which contradicts membership across organizations.

**How permissions are enforced.** Considered:

1. _One permission module in the API_ (chosen). Every route asks it whether this actor may do this to that target, and lists go through query helpers that filter by the actor's memberships. A test helper runs the same cast of users against every endpoint.
2. _Row-level security in PostgreSQL._ The database refuses rows even when code forgets. Rejected for now: harder to debug, every request needs a transaction that sets the user, and the rules for who sees an email address or phone number still need code. It can be added later as a second lock on the field data.
3. _Checks inside each route._ Rejected: agents copy routes, and one forgotten check leaks.

**Login codes in local development.** Considered:

1. _Mailpit in Docker Compose_ (chosen). The API sends real SMTP mail locally, the mail shows in a web inbox, and tests read the code through Mailpit's API. MailHog, the older tool, is no longer maintained.
2. _A fixed code such as 000000._ Rejected: it is a back door that stays shut only while a setting is right.

**Mail in production and staging.** Alwaysdata's own SMTP, with a mailbox on the account (chosen as the first try). No extra vendor and no cost. The plan's worry stands: mail leaves from shared addresses, and Alwaysdata documents no sending limits or delivery logs. So delivery is a check (see "Checks on real phones and on Alwaysdata"), and the code only assumes SMTP, so moving to Lettermint or Brevo is a change of settings.

## Design

### Who is who

A user account is global: it belongs to the person, not to an organization. What a user may do follows from four things, all read from the database on each request:

| Role (glossary)     | How it is stored                         |
| ------------------- | ---------------------------------------- |
| `volunteer`         | A row in `working_group_memberships`     |
| `coordinator`       | Such a row with `is_coordinator` set     |
| `organizationAdmin` | A row in `organization_admins`           |
| `platformAdmin`     | The flag `is_platform_admin` on the user |

A logged-in user with none of these is an **applicant**: they can see the list of working groups and ask to join one, nothing else.

There is no "current organization" in a session. A request names the working group or the record it is about, and the permission module decides from the actor's memberships and admin rows. Lists in the app merge everything the user may see across all their working groups.

An organization admin manages memberships and roles inside their own organization, never the account itself. Only the person and a platform admin can change or delete an account.

### Data model

All tables are snake_case and plural. All IDs are `uuid` columns.

| Table                                   | Columns (besides `created_at`)                                                                                                                                                              | Notes                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                                 | `id`, `name`, `email` (unique, stored lowercase), `email_verified`, `image`, `updated_at`, plus ours: `phone` (nullable), `is_platform_admin` (default false), `deleted_at` (nullable)      | Better Auth's user table, renamed. Our three columns cannot be set through Better Auth's client (`input: false`)                                           |
| `sessions`, `accounts`, `verifications` | As Better Auth needs them                                                                                                                                                                   | Renamed to plural snake_case. Defined in `packages/db` and migrated with Drizzle Kit like every other table                                                |
| `organizations`                         | `id`, `name`                                                                                                                                                                                | The tenant                                                                                                                                                 |
| `working_groups`                        | `id`, `organization_id`, `name`, `city`, `active` (default true)                                                                                                                            | Unique on (`organization_id`, `name`)                                                                                                                      |
| `working_group_memberships`             | `id`, `user_id`, `working_group_id`, `is_coordinator` (default false)                                                                                                                       | The association table. Unique on (`user_id`, `working_group_id`). Ending a membership deletes the row; the audit log keeps the history                     |
| `membership_requests`                   | `id` (client-generated UUIDv7), `user_id`, `working_group_id`, `status` (`pending`, `approved`, `rejected`, `withdrawn`), `requested_at`, `received_at`, `decided_at`, `decided_by_user_id` | At most one `pending` request per (`user_id`, `working_group_id`), as a partial unique index. `requested_at` is the app's time, `received_at` the server's |
| `organization_admins`                   | `user_id`, `organization_id`                                                                                                                                                                | Primary key on both                                                                                                                                        |
| `audit_log_entries`                     | `id`, `occurred_at`, `actor_kind` (`user` or `system`), `actor_user_id` (nullable), `organization_id` (nullable), `action`, `subject_type`, `subject_id`, `details` (jsonb)                 | Append-only                                                                                                                                                |

IDs of accounts, sessions, organizations, working groups, memberships and audit entries are made by the server (`uuidv7()` in PostgreSQL, or Better Auth's UUID setting). That does not break the rule in AGENTS.md: the client-generated ID is for writes from the field that the app may resend. In this part that is the membership request.

`city` is new in the glossary: "plaats" → `city`. It belongs to the working group, not the organization, because an organization can span several places. Also new: "lid" → `member`, "lidmaatschap" → `membership`, "profiel" → `profile`.

Dutch names are sorted with `COLLATE "nl-NL-x-icu"`, as AGENTS.md says.

### Login

Better Auth, exact version pinned (1.7.27 on 21 November 2026), with the email OTP plugin and the Drizzle adapter, mounted in the API on `/api/auth/*` as its Fastify guide describes. The route is hidden from OpenAPI. The auth setup lives in `apps/api`; the worker does not need it.

Settings that differ from Better Auth's defaults, and why:

| Setting              | Value                                                                                 | Why                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Code length          | 6 digits                                                                              | The default; short enough to type, and the form phones recognize                                       |
| Code validity        | 30 minutes (default 5)                                                                | The plan: quickly expiring codes stress older users                                                    |
| Wrong tries per code | 5 (default 3)                                                                         | Room for typing mistakes; after that the user asks for a new code _(Author's call.)_                   |
| Resend               | Sends the same code again (`reuse`)                                                   | Whichever mail the user opens works. The code must then be stored encrypted, not hashed                |
| Sign-up              | An unknown address becomes a new account                                              | One flow for signing up and logging in, and the answer never reveals whether an address has an account |
| Session lifetime     | 180 days, extended on use (at most once a day)                                        | "Long-lived" in the plan; a volunteer who uses the app during the season never logs in twice           |
| Cookie               | `HttpOnly`, `SameSite=Lax`, `Secure` whenever the origin is HTTPS, prefix `padvinder` | AGENTS.md. Local development over plain `http://localhost` has no `Secure`                             |
| Trusted origins      | `ALLOWED_ORIGINS`                                                                     | The same list the Origin hook uses                                                                     |
| Rate limit storage   | PostgreSQL                                                                            | Survives a restart of the API                                                                          |

Rate limits _(numbers are the author's call)_:

- **Per IP address,** through Better Auth's limiter: asking for a code at most 30 times per 5 minutes, checking a code at most 60 times per 5 minutes. The numbers leave room for an instruction evening where a room of volunteers on one Wi-Fi network logs in together. Guessing a code is stopped by the 5 tries per code, not by this limit.
- **Per email address,** which Better Auth does not offer: our own check in a hook that runs before Better Auth's send route, counted in PostgreSQL. At most 3 requests per 15 minutes and 10 per 24 hours for one address. Over the limit the API answers 429 with the code `TOO_MANY_LOGIN_CODES` or, for the daily limit, `TOO_MANY_LOGIN_CODES_TODAY`, and no code is made or sent. A 429 without one of these codes is the limit per IP address; the app shows a different text for each of the three. It cannot live inside the function that sends the mail: Better Auth swallows what that function throws and answers 200. The counters are deleted after 24 hours, because they hold email addresses; Better Auth's counters per IP address too, because their keys hold the address. Sessions store neither the IP address nor the browser.
- **Switching the limits off.** `LOGIN_RATE_LIMITS=off` turns both limits off, for local development and the Playwright run, where every request comes from one address. The API refuses to start with that setting when `PUBLIC_ORIGIN` is an HTTPS origin, so it cannot be on in staging or production. The setup script writes it to `.env`. Tests of the limits themselves switch them on. The check of the code, its expiry and the 5 tries per code have no switch.
- The client IP comes from the reverse proxy's header. Which header Alwaysdata's proxy sets, and whether it overwrites or appends, is checked on staging before the limits are trusted.

The apps use Better Auth's browser client only for three calls: send a code, sign in with a code, sign out. It lives in one module in `packages/api-client`, which maps Better Auth's error codes to a `LoginError` code; `packages/ui` picks the Dutch message for it. Everything the app needs to know about the user comes from our own `GET /api/me`.

After the code is accepted, a new account has no name yet. The app sees that in `/api/me` and asks for it.

The code is never written to a log. Email addresses and names are not logged at `info` level or above.

### The mails

Sent by the API over SMTP through a small mailer interface, so tests inject a fake that keeps the mails in memory. Each mail has a plain-text part and a simple HTML part. The texts live in code for now; whether admins should edit them is a question for part 2.

The API sends the mail without waiting for the result and logs a failure. There are no retries: the login screen has "Stuur opnieuw", and a coordinator sees open requests in the app anyway. Part 3 (push) designs the notification pipeline with retries. _(Author's call.)_

**Mails from staging are marked** (the maintainer, 25 November 2026). The subject of every mail that staging sends starts with `[STAGING] `, so nobody takes a mail from staging for one from production; both send from the same address. Production adds nothing, and neither does local development. It is a setting of the environment, `MAIL_SUBJECT_PREFIX`, which provisioning writes for staging only. The mailer applies it to every mail it sends, so no mail text can forget it. On staging the login code mail's subject is therefore `[STAGING] 123456 is je inlogcode voor PadVinder`, and the code no longer comes first: check how a phone offers the code on production.

**Login code.** Phones find the code by guesswork; neither Apple nor Google publishes a format. So:

- Subject: `123456 is je inlogcode voor PadVinder`, with the code first, so it shows in the notification.
- The code is six digits without a space or hyphen, on its own line, next to the word "code".
- The mail contains no other digits anywhere, in text or HTML: "een half uur", not "30 minuten"; no year, no phone number.

```
Je code: 123456

Vul deze code in bij PadVinder om in te loggen. De code is een half uur geldig.

Heb je geen code aangevraagd? Dan hoef je niets te doen.
```

**New membership request,** to every coordinator of the working group. If the group has no coordinator, to the admins of its organization. Sent once per request, also when the app resends the request.

```
Onderwerp: Nieuwe aanmelding bij Boekelo

Noor de Vries wil meedoen met werkgroep Boekelo.

Open PadVinder en ga naar Meer > Aanmeldingen om de aanmelding te bekijken.
```

It contains the applicant's name and no other personal data, and a link straight to this request. For now that is the request's screen in the app. Once the portal has a page for a request (part 2), the link goes to that page instead; part 2 changes this mail. On an iPhone a link opens Safari instead of the installed app, which is why the text also says where to look.

**Decision,** to the applicant, because without push they would not know. _(Author's call.)_

```
Onderwerp: Je bent toegelaten tot werkgroep Boekelo

Welkom bij werkgroep Boekelo! Open PadVinder om te beginnen.
```

```
Onderwerp: Je aanmelding bij werkgroep Boekelo

Je aanmelding bij werkgroep Boekelo is niet goedgekeurd. In PadVinder kun je een andere werkgroep kiezen.
```

### Local development and tests

- `docker-compose.yml` gets a `mail` service with Mailpit (version pinned), shared by all workspaces like the database, on fixed host ports: SMTP 54325 and the web inbox with its API on 54326. _(Author's call.)_
- `scripts/setup-workspace.sh` writes the SMTP settings and a random auth secret to `.env`.
- Vitest tests use the in-memory mailer. Only Playwright uses Mailpit: a helper asks Mailpit's API for the newest mail to an address and takes the code from the subject. Every test uses its own address, so workspaces that share the inbox do not see each other's mail.
- To log in locally as a seeded user: enter its address and read the code in the Mailpit inbox.

New environment variables: `AUTH_SECRET` (required; the API refuses to start without it outside tests), `PUBLIC_ORIGIN` (Better Auth's base URL and the links in mails), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD` (both optional, for Mailpit), `MAIL_FROM`, `LOGIN_RATE_LIMITS` (see "Login"), and `MAILPIT_URL` for the end-to-end tests.

End-to-end tests that are not about logging in start with a session made by a helper, without the login screens, so they stay fast. Later slices reuse that helper.

### Permissions

One module in `apps/api`. It has three parts:

1. **The actor.** A hook reads the session and loads `{ userId, isPlatformAdmin, memberships, adminOfOrganizationIds }`. A route that needs a login without one answers 401.
2. **The rules.** Pure functions of the form "may this actor do this action to this target", unit-tested as a table. Routes call them; routes never compare roles themselves.
3. **Scoped queries.** Functions in `packages/db` that take the actor's scope and return only rows the actor may see, with only the fields the actor may see. A list endpoint never filters in the route.

Answers: 401 without a login; 404 for a record the actor may not see at all, including everything in another organization, so its existence does not leak; 403 for a record the actor may see but not change.

Who may do what in this part:

| Action                                                          | Applicant | Volunteer of the group | Coordinator of the group | Admin of the organization | Platform admin |
| --------------------------------------------------------------- | --------- | ---------------------- | ------------------------ | ------------------------- | -------------- |
| Read and change own profile; delete own account                 | yes       | yes                    | yes                      | yes                       | yes            |
| List the working groups to choose from                          | yes       | yes                    | yes                      | yes                       | yes            |
| Ask to join a working group; withdraw own request               | yes       | yes                    | yes                      | yes                       | yes            |
| List the members of the group                                   | no        | yes, names and roles   | yes                      | yes                       | yes            |
| See a member's email address and phone number                   | no        | no                     | yes                      | yes                       | yes            |
| List the group's requests, with the applicant's contact details | no        | no                     | yes                      | yes                       | yes            |
| Approve or reject a request                                     | no        | no                     | yes                      | yes                       | yes            |
| Remove a volunteer from the group                               | no        | no                     | yes                      | yes                       | yes            |
| Remove a coordinator from the group                             | no        | no                     | no                       | yes                       | yes            |
| See the database details in the system status                   | no        | no                     | no                       | no                        | yes            |

"Of the group" and "of the organization" are literal: a coordinator of another working group, or an admin of another organization, is an outsider and gets 404.

**Who sees names** (decided by the maintainer on 21 November 2026; it replaces the shorter rule in AGENTS.md):

- Fellow members of a shared working group see your name and role, nothing else.
- Coordinators of that group and admins of that organization see your name, email address and phone number.
- A coordinator and the organization's admins see the same of someone with a pending request to their group.
- Platform admins see everything.
- Names never appear in an export or download, for any role (unchanged).

**The list of working groups** is the one place where data crosses organizations. Any logged-in user gets every active working group with exactly three things: its name, its organization's name and its city. No coordinator names, no member counts, nothing else.

### API

Under `/api`, in `packages/contracts`, generated into OpenAPI and the client like the health endpoint. Paths and field names are the builder's to refine; the behavior is fixed.

| Endpoint                                             | Does                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me`                                            | The user (id, name, email, phone, platform admin or not), their memberships with working group and organization, the organizations they administer, and their open or latest rejected membership request. 401 without a login |
| `PATCH /me`                                          | Changes name (1 to 100 characters after trimming) and phone (free text up to 30 characters, or empty)                                                                                                                         |
| `DELETE /me`                                         | Deletes the account (see "Deleting an account")                                                                                                                                                                               |
| `GET /working-groups`                                | The list to choose from                                                                                                                                                                                                       |
| `POST /membership-requests`                          | Body: `id` (UUIDv7 made by the app), `workingGroupId`, `requestedAt`. Creates a pending request for the logged-in user                                                                                                        |
| `POST /membership-requests/{id}/withdraw`            | The applicant withdraws a pending request                                                                                                                                                                                     |
| `GET /working-groups/{id}/membership-requests`       | The group's pending requests                                                                                                                                                                                                  |
| `POST /membership-requests/{id}/approve`, `…/reject` | The decision                                                                                                                                                                                                                  |
| `GET /working-groups/{id}/members`                   | The members, with the fields the actor may see                                                                                                                                                                                |
| `DELETE /memberships/{id}`                           | Removes a member from the group                                                                                                                                                                                               |

Rules:

- **`PATCH` takes a partial object.** A field that is present is changed; a field that is absent stays as it is; `null` empties a field that may be empty (here: `phone`). An unknown field, or a body without any field, is rejected with 400, so a typo never looks like a success. Sending the same body twice gives the same result, so the app may resend it. This is the rule for every `PATCH` in the API. It is not JSON Patch (RFC 6902): a list of operations is meant for editing arbitrary documents, and it cannot be described field by field in Zod and OpenAPI, so the generated client would lose its types. A full replacement with `PUT` is not used either: an app that is still open on an older version would wipe every field it does not know yet.

- **The request is the first idempotent write.** A `POST` with an `id` the server already has, from the same user, returns the stored record with 200 and changes nothing: no second row, no second mail. The first time it answers 201. An `id` that belongs to someone else answers 409 without showing the record.
- A user who is already a member of the group, or has a pending request for it, gets 409 on a new request with a different `id`.
- A user may have pending requests for several working groups; the app offers one at a time.
- A user can create at most 5 membership requests per 24 hours. More answers 429 with the text "Je hebt vandaag te vaak een aanmelding gestuurd. Probeer het morgen opnieuw." Without it, one account could make PadVinder mail every coordinator again and again by asking and withdrawing. A resend of a stored `id` does not count. _(Author's call.)_
- **Approving** creates the membership, as a volunteer, and sets the request to `approved`, in one transaction with the audit entry and the live events. **Rejecting** sets `rejected`. The first decision counts: the same decision again returns the stored record; the opposite decision, or a decision on a withdrawn request, answers 409.
- A rejected applicant may ask again, also for the same group.
- A request for a working group that is not active answers 404.

**`/api/health`** stays public, with `status`, `commit` and the worker heartbeat. The PostgreSQL version, PostGIS version and latest migration are only filled for a platform admin; how the contract expresses "hidden" is the builder's call, as long as the status screen can tell hidden from missing.

**Errors.** One schema in `packages/contracts` for every error our own routes return: Fastify's `statusCode`, `error` and `message` (English, for developers), plus `code`, a stable lowercase identifier such as `already_decided`. The apps choose the Dutch text from `code`; they never show `message`. A validation failure is 400 with `code: "invalid_request"`. Every route lists its error responses in OpenAPI. The Origin hook's 403 gets the same shape.

### Live events

`/api/events` now needs a login: 401 without one. Each event type in `packages/contracts` declares one audience, and the stream delivers an event only to connections that match. The map of audiences is complete: an event type without an audience does not compile.

| Audience                     | The event carries                  | Delivered to                                                                                               |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `user`                       | `userId`                           | That user                                                                                                  |
| `working-group-coordinators` | `workingGroupId`, `organizationId` | Coordinators of that group and admins of its organization                                                  |
| `working-group-members`      | `workingGroupId`, `organizationId` | Every member of that group and admins of its organization. Not used yet; slice 4 needs it for check status |
| `organization`               | `organizationId`                   | Everyone with a membership or admin row in that organization. Not used yet                                 |
| `platform-admins`            | nothing                            | Platform admins                                                                                            |

Platform admins also receive every event except those for `user`: an event addressed to one person reaches only that person (decided by the maintainer on 24 November 2026, so later personal messages stay private).

Events in this part, each carrying IDs only:

- `worker-heartbeat` (exists): audience `platform-admins`.
- `membership-requests-changed`: a request for a group was created, withdrawn or decided. Audience `working-group-coordinators`. The app refetches the request list and its count.
- `access-changed`: a user's memberships, roles or requests changed. Audience `user`. The app refetches `/api/me`, so the waiting screen turns into the tabs without a reload.

A connection's rights can change while it is open. The stream reloads the actor when an `access-changed` event for its user passes, checks at least every 5 minutes that the session still exists, and closes when it does not. _(Interval is the author's call.)_

### The mobile app

What the app shows follows from `/api/me`, in this order:

| State                                         | Screen                   |
| --------------------------------------------- | ------------------------ |
| Not logged in                                 | Email address, then code |
| Logged in, no name yet                        | "Hoe heet je?"           |
| No membership, no admin role, no open request | "Kies je werkgroep"      |
| A pending request, no membership              | "Welkom!" (waiting)      |
| A membership or an admin role                 | The four tabs            |

Copy is exact unless marked; the builder writes the remaining small texts in the same style.

**Email address.** Heading "Log in bij PadVinder". Text "Vul je e-mailadres in. Je krijgt een code per mail." Field "E-mailadres". Button "Stuur code".

**Code.** Heading "Vul je code in". Text "We hebben een code gestuurd naar {email}. De code is een half uur geldig." One field "Code", not six boxes: `autocomplete="one-time-code"`, numeric keyboard, accepts a pasted code with spaces or a hyphen, submits at six digits. Buttons "Open je mail" and "Stuur opnieuw", and a link "Ander e-mailadres".

"Open je mail" opens the phone's mail app where the platform allows it. It is a device feature in its own module. If it cannot work reliably on a platform, the button is hidden there.

Messages:

| Situation                       | Text                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Not an email address            | "Vul een geldig e-mailadres in."                                               |
| Wrong code                      | "Deze code klopt niet. Kijk nog eens in je mail."                              |
| Code expired                    | "Deze code is verlopen. Vraag een nieuwe code aan."                            |
| Too many wrong tries            | "Te veel pogingen. Vraag een nieuwe code aan."                                 |
| Too many codes requested        | "Je hebt te vaak een code aangevraagd. Probeer het over een kwartier opnieuw." |
| Too many codes in 24 hours      | "Je hebt te vaak een code aangevraagd. Probeer het morgen opnieuw."            |
| Limit per IP address            | "Het is nu erg druk. Probeer het over een paar minuten opnieuw."               |
| Too many membership requests    | "Je hebt vandaag te vaak een aanmelding gestuurd. Probeer het morgen opnieuw." |
| No connection or a server error | "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw."           |

**Name.** Heading "Hoe heet je?". Fields "Naam" and "Telefoonnummer (optioneel)". Text "Je naam is te zien voor de mensen in je werkgroep. Je telefoonnummer alleen voor de coördinator van de werkgroep." Button "Ga verder".

**Choosing a working group** (the maintainer's design). Heading "Kies je werkgroep". A filter field at the top, "Zoek op werkgroep, organisatie of plaats", then one list of all working groups from all organizations. Each row shows the group's name, and below it the organization and the city. Typing filters the list in the browser: a row stays when the text occurs in its name, its organization or its city, ignoring case and accents. Choosing a row and tapping "Meld je aan" sends the request. No match: "Geen werkgroep gevonden."

After a rejection, the same screen shows above the list: "Je aanmelding bij {werkgroep} is niet goedgekeurd. Je kunt een andere werkgroep kiezen." No reason is shown.

**Waiting.** Heading "Welkom!". Text "De coördinator van {werkgroep} neemt contact met je op om kennis te maken. Dat kan een paar dagen duren." Buttons "Trek aanmelding in" and "Log uit", and a link to "Profiel".

**The tabs.** Vanavond, Kaart and Resultaten keep "Komt binnenkort." The Meer tab lists:

- **Profiel.** Name and phone number (editable, button "Bewaar"), email address (read-only), the user's working groups, and "Verwijder account".
- **Aanmeldingen,** for coordinators and organization admins, with the number of open requests. A request shows the name, the email address and phone number as links that mail and call, and "Aangemeld op {datum}". Buttons "Keur goed" and "Wijs af"; rejecting asks "Aanmelding afwijzen?" first. When someone else decided in the meantime: "Deze aanmelding is al behandeld."
- **Leden,** for every member: the names in the group, with "coördinator" next to coordinators. A coordinator or admin can open a member to see the contact details and "Verwijder uit werkgroep", which asks for confirmation.
- **Systeemstatus,** for platform admins only.
- **Log uit.**

Aanmeldingen and Leden are grouped per working group, and work for a user in several groups, also across organizations, even though the app offers no way to join a second one yet.

**Deleting an account.** "Verwijder account" opens a prompt. Heading "Account verwijderen?". Text "Je naam, e-mailadres en telefoonnummer worden gewist. Wat je hebt geteld blijft bewaard, zonder je naam. Dit kun je niet terugdraaien." Buttons "Verwijder account" and "Annuleer". Afterwards the login screen shows "Je account is verwijderd."

### The portal

The same login, with the same shared components. After login, a platform admin sees the link to the system status page. Everyone else sees "Hier is nog niets te doen. Het beheer komt binnenkort." and "Log uit". The system status page answers "not allowed" to anyone who is not a platform admin.

### Deleting an account

A soft delete (the maintainer's design). `DELETE /api/me` does all of this in one transaction:

- sets the name to "Verwijderd account", empties the phone number and image, and sets `deleted_at`;
- replaces the email address with `deleted-<user id>@deleted.invalid`, which is unique, is never shown and cannot receive mail;
- removes the platform admin flag;
- deletes the user's sessions and Better Auth's other rows for the user;
- deletes the user's memberships and organization admin rows, and withdraws their pending requests;
- writes an audit entry, and sends the live events that follow.

The row in `users` stays, and so does everything that points at it: decided requests now, rounds and drain checks later. Wherever the name would appear, "Verwijderd account" appears.

It cannot be undone, by anyone. Logging in later with the same address creates a fresh account with no link to the old one.

The last platform admin cannot delete their own account: 409, with the text "Je bent de enige hoofdbeheerder. Maak eerst iemand anders hoofdbeheerder."

A coordinator may delete their account even when the group then has no coordinator; the organization's admins still see its requests.

### The audit log

The rule: record it when one person decides or changes something about another person or about shared data. A person's own registrations are not audit entries (the record itself says who and when), and neither are views or logins.

Entries in this part:

| Action                                          | Written when                            |
| ----------------------------------------------- | --------------------------------------- |
| `membership_request.approved`, `.rejected`      | A coordinator or admin decides          |
| `membership.removed`                            | A coordinator or admin removes a member |
| `role.coordinator_granted`, `.revoked`          | Through the command-line tool           |
| `role.organization_admin_granted`, `.revoked`   | Through the command-line tool           |
| `role.platform_admin_granted`, `.revoked`       | Through the command-line tool           |
| `organization.created`, `working_group.created` | Through the command-line tool           |
| `account.deleted`                               | A user deletes their account            |

- One function writes an entry, and it takes the transaction that makes the change, like `notify` does, so an entry exists exactly when the change was committed.
- Entries are never updated or deleted. The database enforces that.
- `details` holds which fields changed and non-personal values (a role, a status). It never holds a name, an email address or a phone number. People appear by ID only, so a deleted account leaves no personal data in the log.
- The command-line tool writes entries with `actor_kind` `system`.

Later parts add their own actions (species, texts and settings, safety test versions, corrections, imports, every export). How long entries are kept is not decided; nothing deletes them for now.

### The command-line tool

Until the portal has screens, `pnpm admin <command>` does the administration, locally and on the server over SSH from the release directory:

- create an organization; create a working group (name, city) in an organization;
- make someone platform admin, organization admin or coordinator of a group, and take that away again.

A person is named by email address. Granting a role to an address without an account creates the account, so the first platform admin can be made before anyone has logged in. Making someone coordinator creates the membership when there is none.

The deploy artifact must contain this tool. See "What deployment needs".

### Seed data

`pnpm db:seed` adds made-up data, idempotently, for local development and tests only. It never runs on staging or production. At least: two organizations, three working groups across them in two made-up places, and one user for each role (platform admin, organization admin, coordinator, volunteer), one applicant with a pending request, and one volunteer who is a member in both organizations. All addresses end in `@example.test`.

### Tests

As the table in AGENTS.md requires. The parts that need care:

- **A standard cast for permission tests,** in a test helper: a platform admin, an organization admin, a coordinator and a volunteer of one group, a volunteer of another group in the same organization, a coordinator in another organization, and an applicant. Every endpoint is tested with each cast member that may, one that may not, the one from the other organization, and where groups matter the one from the other group. The helper logs a cast member in without sending a mail.
- **Fields, not only rows:** the member list a volunteer gets contains no email address or phone number at all, checked on the raw response.
- **Idempotency:** the same membership request twice gives one row and one mail.
- **Login through the real Better Auth routes** with the in-memory mailer: the whole flow; a wrong code; five wrong codes; an expired code; a resend that carries the same code; both rate limits; the cookie's attributes.
- **The login mail:** the subject starts with the code, and the mail contains no other digit.
- **Live events:** no login gives 401; a coordinator of another organization does not receive an event of this one; an applicant's stream receives `access-changed` after approval.
- **Deleting an account:** the personal fields are gone, the sessions are gone, the same address gets a new account, and the last platform admin is refused.
- **The audit log:** each action above writes one entry in the same transaction; an update or delete of an entry fails.
- **Playwright,** with Mailpit: a new volunteer signs up, chooses a group and waits; a coordinator approves; the volunteer's screen shows the tabs. And: a user deletes their account. The existing system status test logs in as a platform admin.
- **Stories** for every screen state, with fixture data.

### Checks on real phones and on Alwaysdata

Recorded in `infra/alwaysdata/README.md` or the pull request, whichever exists by then:

- A login code reaches Gmail, Outlook, iCloud, KPN and Ziggo inboxes, not the spam folder, with SPF, DKIM and DMARC passing. If not, switch to a transactional mail service.
- On an iPhone with Apple Mail, the code is offered above the keyboard, in Safari and in the installed app, with the Dutch text. In Gmail, the "Copy code" button appears. These are best effort: the documented requirement is only the `autocomplete` attribute.
- The reverse proxy passes the client's IP address in a header that cannot be forged, so the limit per IP address means something.
- "Open je mail" on an iPhone and on Android.

### What deployment needs

Deployment is built in another workspace at the same time. Whichever lands second adds:

- A Mailpit service for the Playwright job in CI.
- The secrets `AUTH_SECRET` and the SMTP settings per environment, written to the environment file by provisioning.
- A mailbox on the Alwaysdata account for the sender address, and the SPF, DKIM and DMARC records, which the maintainer copies to the DNS provider. The README records them.
- The command-line tool in the deploy artifact.

### AGENTS.md

Updated in the pull requests that build this: the new glossary terms, the rule on who sees names, the new commands and environment variables, and short pointers to the reference examples: the membership request for an idempotent write, the permission module, the audit log function, the error schema, and an event with an audience. The placeholder notes about "arrives in slice 1" go.

## Follow-ups for the other parts

- **Part 2 (portal):** a page for one membership request, and the mail to coordinators links to it. Screens that replace the command-line tool, and a screen to read the audit log. Decide whether admins can edit the mail texts.
- **Part 3 (push):** the "Nieuwe aanmelding" push to coordinators, and a notification pipeline with retries that the mails can move to.

## Order of work

Three pull requests, in this order, each with its own plan:

1. **Login.** Better Auth and its tables, the mailer and Mailpit, the error schema, `GET` and `PATCH /api/me`, the login and name screens in both apps, logging out, an event stream that needs a login, and the end-to-end login test. After this pull request every logged-in user still sees the system status and receives the heartbeat event, because nobody can be made platform admin yet.
2. **Access model.** Organizations, working groups, memberships and admin rows, the permission module with its test cast, the audit log, the command-line tool and the seed data. This pull request limits the health details, the system status screens and the heartbeat event to platform admins, and adds event audiences.
3. **Joining.** The list of working groups, membership requests and decisions, members, the mails to coordinators and applicants, the two live events, the profile screen, deleting an account, and the end-to-end tests.

## Left to the builder

- File and module names, the split of screens into components, and exact API paths and field names within the behavior above.
- How Better Auth's tables are written in Drizzle (generated once or by hand), and how its IDs become UUIDs.
- Whether Better Auth creates rows in `accounts` for email codes, and what "Better Auth's other rows" means when deleting an account.
- Where the per-email counters live, and how they are pruned.
- The SMTP library (nodemailer is the obvious one).
- How the contract expresses hidden health details.
- How the audit log's append-only rule is enforced in the database.
- How the test helper logs a cast member in (Better Auth has test utilities).
- The command-line tool's argument syntax, and how it is bundled.
- Remaining small Dutch texts, in the style of AGENTS.md.

The design's assumptions about Better Auth were checked against version 1.7.27 on 21 November 2026: resending the same code, encrypted storage of codes, 5 tries, limits per path stored in PostgreSQL, UUIDs, and Drizzle 1.0 RC. If one of them turns out not to hold, stop and tell the maintainer rather than working around it silently.

## Open questions

None that block planning. Decided later, outside this design: how long audit entries and deleted accounts are kept, and whether mail texts become editable by admins.
