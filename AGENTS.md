# AGENTS.md

Guidance for AI agents and human contributors working in this repository.

PadVinder is a mobile web app (PWA) plus a web portal for volunteer groups that help amphibians cross roads during the spring migration ("paddentrek") and that monitor street drains for trapped animals ("Pad uit de put"). Volunteers count animals in the field; coordinators and admins manage routes, drains and species; reports follow directly from the counts. The first user is Paddentrek Enschede. See `README.md` (Dutch) for the public description.

This file summarizes the technical chapter (section 16) of the project plan of 20 November 2026. The plan itself is in Dutch and is not in this repository. When the plan and this file disagree, ask the maintainer.

## Current state

The repository contains no code yet. Everything below under "Repository layout" and "Development workflow" describes the intended setup, not what exists. When you scaffold a part, update this file with the real commands and paths in the same pull request.

Milestones:

- **v1, January 2027:** drains. Accounts and roles, safety test, drain register, drain routes and drain checks (slices 1–5). The 2027 season is the baseline measurement for the drain project and cannot be redone, so reliability of registration and data safety come before features.
- **v1.1, shortly after:** counting toads on transects, buckets and fences, verification of rare species (slices 6–9).
- **Later:** incidental observations, sign-ups, weather advice, historical import, reports, public results.

Feature freeze around 1 February each year; during the migration season only fixes.

## Language

- **Code is English:** identifiers, file names, database tables and columns, API paths and fields, comments, tests, commit messages, pull requests and technical documentation. Use American spelling (`organization`, `color`).
- **Everything a user reads is Dutch:** UI copy, emails, push notifications, validation messages, export column headers. The app is Dutch-only; there is no translation layer and no i18n library. Write Dutch copy inline.
- **URL paths are English,** also for pages a user sees in the address bar: `/transects`, not `/trajecten`.
- **Domain terms** come from the Dutch project plan. Use the English identifier from the glossary below in code, and the Dutch term in UI copy, exactly as listed. Do not invent a second translation for the same concept. If a concept is missing, add it to the glossary in the same pull request.
- `README.md` stays in Dutch: it addresses volunteers and the public.

### Dutch copy

- Address the user informally with "je", never "u".
- Write short, active sentences in plain words. Readers range from children to pensioners, and they read on a phone, outdoors, in the evening.
- Use the Dutch glossary terms exactly; do not vary them ("traject" stays "traject", not "route" or "pad").
- Avoid English and technical jargon. Say what the user can do next, not what went wrong inside the system.
- Use sentence case for buttons and headings: "Open je mail", "Werk de app bij".

### Glossary

| Dutch (UI) | English (code) | Meaning |
| --- | --- | --- |
| organisatie | `organization` | An organization of working groups, such as Paddentrek Enschede. The tenant boundary |
| werkgroep | `workingGroup` | A local group of volunteers with one or more coordinators |
| traject | `transect` | A fixed path that volunteers walk. Two kinds: a toad migration transect, or a drain route. Named `transect` to avoid confusion with HTTP and React Router routes |
| puttenroute | `transect` of kind `drain` ("drain route") | A transect along drains |
| put | `drain` | A street drain (gully pot) that is checked for trapped animals |
| putcontrole | `drainCheck` | Looking into one drain once: animals per species alive/dead, "empty", or "failed" with a reason |
| lediging | `emptying` | The municipality emptying a drain, from the yearly calendar |
| uittreedvoorziening | `escapeDevice` | A ladder or ramp that lets animals climb out of a drain |
| emmer | `bucket` | A bucket dug into the ground, usually along a fence |
| scherm | `fence` | An amphibian fence along a road |
| ronde | `round` | Walking one transect once, from start to stop |
| waarneming | `observation` | A counted animal or number of animals: in a round, at a bucket or in a drain |
| nulwaarneming | (a `round` without observations) | Effort with nothing found; always stored |
| losse waarneming | `incidentalObservation` | A report outside a regular round, also by visitors without an account (later) |
| intekening | `roundSignup` | An optional announcement "I will walk this transect around this time" (later) |
| aanmelding | `membershipRequest` | A new volunteer asking to join a working group; a coordinator approves |
| maatregel | `protectionMeasure` | A fence, bucket, fauna tunnel or escape device |
| soort | `species` | Official species list, managed by admins |
| levend / dood | `alive` / `dead` | |
| onbekend | `unknown` | Unknown species (photo required), or a missing value in imported data |
| controlestatus | `checkStatus` | When a transect, drain or bucket was last checked. Derived, never entered |
| veiligheidstoets | `safetyTest` | Safety test a volunteer passes before checking drains; versioned, renewed yearly |
| bevoegdheid | `safetyClearance` | The recorded result: test version, date and acceptance |
| betrouwbaarheidsstatus | `verificationStatus` | Self-registered, checked by coordinator, confirmed by expert, unknown or uncertain |
| weergave | `viewMode` | `beginner`, `standard` or `advanced`. How the input screen looks; not a permission |
| rol | `role` | What a user may do |
| bezoeker | `visitor` | No account |
| vrijwilliger | `volunteer` | |
| coördinator | `coordinator` | Per working group |
| organisatiebeheerder | `organizationAdmin` | |
| hoofdbeheerder | `platformAdmin` | PadVinder staff; manages all organizations |
| tik | `tap` | One press on a count button |

Keep these names as they are, untranslated: PadVinder, Paddentrek Enschede, Pad uit de put, RAVON.

### Naming

The glossary lists identifiers in camelCase. Adapt the casing to where the name is used:

| Where | Convention | Example |
| --- | --- | --- |
| TypeScript variables, functions and object keys; JSON fields in the API | camelCase | `drainCheck`, `observedAt` |
| TypeScript types and React components | PascalCase | `DrainCheck`, `DrainCheckForm` |
| Files and directories | kebab-case | `drain-check-form.tsx` |
| Database tables | snake_case, plural | `drain_checks` |
| Database columns | snake_case | `observed_at` |
| URL paths, for the API and for pages | kebab-case, plural for collections | `/drain-checks` |

## Repository layout (intended)

One monorepo with pnpm workspaces.

```
apps/
  mobile/           PWA for volunteers, phone only
  portal/           Web portal: administration (CMS), reports, later public results
  api/              Fastify API, SSE, and the static builds of mobile and portal
  worker/           Background jobs with pg-boss; no HTTP
packages/           Shared libraries: UI components (with Storybook), map, types, validation
```

Each app has its own build. CI bundles all four into one deployment artifact: the API serves the builds of `mobile` and `portal` as static files, and the worker runs from the same artifact as a second service.

## Tech stack

Status is taken from the plan. **Decided** is settled: do not replace it without asking. **Proposed** is the working assumption. **Verify first** must be proven on Alwaysdata in the first sprint before features build on it.

### Frontend (mobile and portal)

| Area | Choice | Status |
| --- | --- | --- |
| App form | PWA with React and TypeScript, built with Vite. No Capacitor for now | Decided |
| PWA | `vite-plugin-pwa` for manifest and service worker; display `standalone` | Decided |
| Styling and components | Tailwind with shadcn/ui | Decided |
| Data layer | Client generated from the OpenAPI description, with TanStack Query. SSE updates the query cache | Decided |
| Routing | React Router | Decided |
| Maps | MapLibre GL JS through `react-map-gl`, OpenStreetMap as base map. Tile provider not yet chosen | Decided |
| Drawing lines on the map | Terra Draw | To try in the first sprint |
| Charts | ECharts. Not Recharts | Decided |
| Session | httpOnly cookie, the same in mobile and portal | Decided |
| Tests | Vitest for logic and components, Playwright for whole screens | Decided |
| Package manager | pnpm | Decided |
| Lint and format | Oxlint for linting, Oxfmt for formatting, for the whole monorepo. No ESLint, Prettier or Biome. Oxfmt was still in beta when this was chosen (February 2026); pin its version and review upgrades | Decided |

### Backend and hosting

| Area | Choice | Status |
| --- | --- | --- |
| Language and framework | TypeScript on Node.js 24 LTS, with Fastify | Decided |
| API | JSON over HTTP (REST-like), described with OpenAPI. The OpenAPI description is generated from the Zod schemas, never written by hand | Decided |
| Validation | Zod | Decided |
| Database | PostgreSQL with PostGIS; separate databases for production and staging | Decided |
| Database access | Drizzle ORM, Drizzle Kit for migrations. Raw SQL for PostGIS queries Drizzle cannot express | Decided |
| Authentication | Better Auth: one-time code by email, sessions in PostgreSQL, Drizzle adapter. No passwords | Decided |
| Push | Web Push with the `web-push` library and our own VAPID key pair; subscriptions per device in PostgreSQL | Decided |
| Hosting | Alwaysdata Plus Small (1 CPU, 1 GB RAM), production and staging on the same plan | Decided |
| Source and CI | GitHub with GitHub Actions; the repository is public | Decided |
| Realtime | Server-Sent Events on the API, fed by PostgreSQL `LISTEN`/`NOTIFY` | Verify first |
| Background jobs | pg-boss in the worker service: cron, delayed jobs, retries | Verify first |
| Processes | Per environment two services: `padvinder-api` and `padvinder-worker`. They talk only through PostgreSQL | Verify first |
| Deployment | CI builds one artifact with all dependencies, copies it with rsync over SSH, restarts the services through the Alwaysdata API. The same run builds a container image and smoke-tests it | Proposed |
| Files and photos | On local disk, behind a storage interface with a disk driver and an S3 driver; access through the API with temporary links | Proposed |
| Email | SMTP through a transactional mail service (Lettermint or Brevo) | Proposed |
| Secrets | GitHub Actions Secrets, set as environment variables on the services | Proposed |
| Extra backups | Hourly `pg_dump` to a second location during the season | Proposed |

## Constraints behind these choices

Weigh every new dependency or service against these:

- **Running costs stay very low.** The target is under € 200 per year; the current design costs about € 70–75.
- **No vendor lock-in.** Everything runs as plain Linux processes against a standard PostgreSQL. Moving to another host must stay a matter of dump and restore, copying files and changing DNS. Do not use provider-specific features.
- **As little third-party SaaS as possible** inside the application, unless it is free. Prefer building it into our own backend and database. No Firebase, no Redis, no hosted auth.
- **Mainstream, debuggable technology.** Most code is written by AI; humans and agents must be able to debug it with the browser tools and `curl`.
- **Data stays in the EU.**
- **Phone only** for the mobile app. No tablet or desktop layouts there.

## Architecture rules

### Data integrity

- **Never lose or double-count a registration.** The app buffers registrations locally and resends them after a short connection drop, so every write from the field (a tap, an observation, a round, a drain check) must be idempotent.
- **The client generates the ID, as a UUIDv7.** That ID is the record's primary key and its idempotency key: the app creates it once, when the user acts, and sends the same ID on every resend. A `POST` with an ID the server already has returns the stored record and changes nothing. The server never replaces a client-generated ID with one of its own.
- **There is no offline mode.** The app needs a connection. Buffering covers brief interruptions only. Do not build sync or conflict resolution, and do not make design choices that would rule out offline registration later.
- **Effort is always recorded.** A round without observations and an empty drain check are stored like any other. "Nothing found" must stay distinguishable from "not checked".
- **Check status is derived, never stored as user input.** It follows from the latest round, drain check or bucket count. A round in progress shows as "being walked now", with start time and who. A round without activity is closed automatically by a background job.
- **Transects, drains and buckets behave alike.** All three have a check status and appear in the same lists and on the same map.
- **Corrections keep history.** The original registration stays traceable. An audit log records who changed or approved what.
- **Missing values in imported data stay `unknown`.** Never fill them with assumptions.

### Time

- **The time of an action is not the time it arrived.** A buffered registration reaches the server later than it happened. The client records when the user acted (for example `observedAt`, `startedAt`) and sends it along; the server separately records when it received the request (`receivedAt`). Reports and check status use the time of the action. Keep both, so a wrong phone clock can be detected.
- **Do not read the time from the UUIDv7.** It is an ID, not a field.
- **Store every moment as `timestamptz`,** and send it over the API as ISO 8601 with an offset.
- **Day boundaries use Europe/Amsterdam,** never the server's time zone: "up to and including yesterday", scheduled jobs, and time blocks that depend on sunset.

### Location and geometry

- **Store all geometry in WGS84 (EPSG:4326).** The API, GeoJSON and MapLibre use the same.
- **Coordinate order is longitude, latitude,** as in GeoJSON, PostGIS and MapLibre. Never pass a bare number pair around: use GeoJSON or named `longitude` and `latitude` fields.
- **Distances and lengths are in meters.** Compute them on the PostGIS `geography` type or in a projected coordinate system, never in degrees.
- **Store the GPS accuracy in meters** with every position, as the device reports it.
- **Imports state their source coordinate system explicitly.** It is not yet known in which coordinate system the municipality's drain data arrives; Dutch government data is often in RD New (EPSG:28992). The importer reads the coordinate system from the file where the format carries it, otherwise requires it as input, transforms to WGS84, and checks that the result is plausible before saving. Never guess the coordinate system from the values.

### Multi-tenancy, permissions and privacy

- **Organizations are strictly separated:** PadVinder → organization → working group → transects and volunteers. Scope every query by organization. A volunteer can belong to several working groups.
- **Role and view mode are separate.** The role and the safety clearance decide what a user may do; the view mode only changes how the input screen looks. Never use the view mode for authorization.
- **Enforce permissions on the server,** per row and per field. Risky actions on drains require a valid safety clearance.
- **Names of volunteers are visible only within their own working group, and never appear in any export or download,** for any role.
- **Not public:** drains, buckets, exact locations of observations, and personal data. Public pages show transects and aggregated numbers only.
- **Photos are private until moderated.** Strip metadata and GPS from photos that become public.
- **Collect minimal personal data:** name, email (required), phone (optional), working group. No address, no date of birth. Children have no accounts.
- **Location:** GPS per observation and per drain check, in the foreground, after explicit consent. Never record a walked track, and never use location in the background.
- **This repository is public.** Never commit secrets, real personal data, or real locations of drains, buckets or observations. Fixtures and seed data are made up.

### Sessions and login

- **The session cookie is `HttpOnly`, `Secure` and `SameSite=Lax`.**
- **A `GET` never changes state.** The server rejects state-changing requests whose `Origin` is not one of our own, and allows no cross-origin requests from other sites.
- **Rate-limit requesting and verifying login codes,** per email address and per IP address.
- **Login codes are valid for 15 to 30 minutes** and appear in the subject line of the email. Sessions are long-lived.
- Check what Better Auth already provides before building any of this yourself.

### API and versioning

- **Zod schemas are the single source for the API contract.** They live in `packages/`. Fastify validates requests and responses with them, the OpenAPI description is generated from them, and the client is generated from the OpenAPI description. Infer TypeScript types from the schemas; do not write the same shape twice.
- **The API is backward compatible.** An open app keeps running old code. Only add fields; never rename or remove one while an old app version uses it.
- **Database migrations go in two steps:** add the new thing first, remove the old thing in a later release.
- **Minimum version:** the API reports the minimum app version; an older app shows "Werk de app bij" and reloads.
- **App version** is CalVer `YYYY.N.P`, for example `2027.1.0`. The year is the migration season, not the release date: a release in December 2026 for the 2027 season is `2027.x`. The build number is the CI run number. Portal and API are identified by git commit.

### Frontend

- **Device features each live in their own module or hook** (position, wake lock, push, camera, vibration), so a later move to Capacitor touches few places. Do not add a general abstraction layer on top.
- **Shared code goes in `packages/`:** UI components, map, types and validation are written once and used by mobile, portal and API. Do not duplicate types between frontend and backend.
- **Never edit the generated OpenAPI description or the generated client by hand.** Change the Zod schema and regenerate.
- **UI components get Storybook stories with fixture data.** Stories are also the visual regression tests.
- **The input screen must work with one hand and wet fingers,** for users from young to old: large targets, high contrast, few steps.
- **Content is managed in the portal, not in code:** species, choice lists, count categories, drain types, help texts, FAQ, colors, settings and safety test versions. Do not hard-code what an admin should be able to change.

### Backend

- **Connect to PostgreSQL on port 5432, not through pgBouncer (5433).** pgBouncer breaks `LISTEN`/`NOTIFY`.
- **Fastify listens on `::`.** Alwaysdata services are reachable over IPv6 only.
- **API and worker communicate only through PostgreSQL.** The worker has no HTTP interface. Scheduling lives in the application (pg-boss), not in the hosting provider's cron.
- **File access goes through the storage interface.** Never read or write uploads directly from feature code.
- **Remove expired push subscriptions** when the push service answers 410.

## Platform constraints (PWA)

Check these before designing a feature that depends on a device capability.

| Capability | Android (Chrome) | iPhone (Safari) |
| --- | --- | --- |
| Push notifications | Yes, also without installing | Only after installing to the home screen (iOS 16.4+), with permission requested after a tap |
| Vibration | Yes | No. Use sound or a clear screen instead |
| Screen wake lock | Yes | Yes, in an installed PWA from iOS 18.4 |
| Background sync | Yes | No. Buffered data is sent when the app is open again. Unused web data may be wiped after 7 days |
| Links open in the app | Yes, if installed | No, links open in Safari. Only a push notification opens the installed PWA |
| Install | Own button triggers the system prompt | Manual through the share menu; the app explains with pictures |
| Session after install | Kept | Installed PWA has separate storage, so the user logs in again |

Service worker, camera and push work only over HTTPS, also during local development.

## Development workflow (intended)

- **Every change goes through a pull request and CI,** also with one developer. Short-lived branches from `main`.
- **CI on every pull request:** type check, lint, unit tests (Vitest), and visual tests of the Storybook stories (Vitest with `toMatchScreenshot`; reference images are generated in the Playwright Docker image, not on your own machine).
- **Local setup:** Docker Compose for PostgreSQL with PostGIS; the API and the Vite dev server run directly on the host. To test on a phone, open the Vite dev server over the local network with HTTPS and a local certificate.
- **Deployment:** merging to `main` deploys to staging automatically; production follows after approval. Migrations run on the server in the deploy step, before the services restart. Staging shares 1 GB of RAM with production, so it may be switched off when unused.
- **Do not install dependencies on the server.** The artifact contains everything.

### Tests

Every change has tests, with no exception for small changes. What that means depends on the change:

| Change | Test it needs |
| --- | --- |
| Logic, validation, calculations | A Vitest unit test |
| API endpoint | A test against a real PostgreSQL with PostGIS, not a mock: the success case, a rejected invalid request, and the permission cases below |
| Anything behind a permission | A test for each role that may, one for a role that may not, and one showing that a user from another organization is denied. Where working groups matter, also a user from another working group |
| Endpoint that takes writes from the field | A test that sends the same ID twice and finds one record |
| Export or download | A test that the output contains no volunteer names |
| UI component | A Storybook story with fixture data, which is its visual test; a Vitest component test for behavior |
| Flow across several screens | A Playwright test |
| Bug fix | A test that fails without the fix |
| Database migration | Run it against a database that already holds data in the old shape |

## Open technical points

Do not assume an answer to these; ask or leave a clear note.

- Whether pg-boss, long-lived SSE connections and `LISTEN`/`NOTIFY` work reliably on Alwaysdata, and whether four processes fit in 1 GB.
- Terra Draw for drawing lines; Drizzle column types for line geometry; the Better Auth integration with Fastify; the library that connects Zod, Fastify and the OpenAPI generation.
- Oxlint and Oxfmt configuration: which rules, whether Oxfmt sorts Tailwind classes (check its current docs for the default), and whether type-aware linting is worth its cost in CI.
- The OpenStreetMap tile provider, the second backup location, and the transactional mail service.
- The format and coordinate system of the municipality's drain data (GeoJSON, GeoPackage or CSV), which determine the importer.
- Accessibility requirements (possibly WCAG), and the visual identity (red, white and a little black; exact colors, logo and typography not yet set).
