# AGENTS.md

Guidance for AI agents and human contributors working in this repository.

PadVinder is a mobile web app (PWA) plus a web portal for volunteer groups that help amphibians cross roads during the spring migration ("paddentrek") and that monitor street drains for trapped animals ("Pad uit de put"). Volunteers count animals in the field; coordinators and admins manage routes, drains and species; reports follow directly from the counts. The first user is Paddentrek Enschede. See `README.md` (Dutch) for the public description.

This file summarizes the technical chapter (section 16) of the project plan of 20 November 2026. The plan itself is in Dutch and is not in this repository. When the plan and this file disagree, ask the maintainer.

## Current state

The repository holds the monorepo skeleton (21 November 2026): one vertical slice through every layer (the health endpoint, see "Reference example"), local development, tests and the generated API client. CI runs on every pull request (see "CI"), and a release can be built as a directory, a tarball and a container image. Deployment to Alwaysdata exists (22 November 2026, pull request 3): provisioning and deploy scripts in `infra/alwaysdata/`, and the workflows that run them. It is tested against fakes only; nothing has run against the real account yet, and the Alwaysdata questions in "Open technical points" stay open until the first deploy to staging (see "Verification" in `infra/alwaysdata/README.md`). Authentication does not exist yet, and there are no write endpoints. Update this file in the same pull request when you change a command or a path below.

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

| Dutch (UI)             | English (code)                             | Meaning                                                                                                                                                          |
| ---------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| organisatie            | `organization`                             | An organization of working groups, such as Paddentrek Enschede. The tenant boundary                                                                              |
| werkgroep              | `workingGroup`                             | A local group of volunteers with one or more coordinators                                                                                                        |
| traject                | `transect`                                 | A fixed path that volunteers walk. Two kinds: a toad migration transect, or a drain route. Named `transect` to avoid confusion with HTTP and React Router routes |
| puttenroute            | `transect` of kind `drain` ("drain route") | A transect along drains                                                                                                                                          |
| put                    | `drain`                                    | A street drain (gully pot) that is checked for trapped animals                                                                                                   |
| putcontrole            | `drainCheck`                               | Looking into one drain once: animals per species alive/dead, "empty", or "failed" with a reason                                                                  |
| lediging               | `emptying`                                 | The municipality emptying a drain, from the yearly calendar                                                                                                      |
| uittreedvoorziening    | `escapeDevice`                             | A ladder or ramp that lets animals climb out of a drain                                                                                                          |
| emmer                  | `bucket`                                   | A bucket dug into the ground, usually along a fence                                                                                                              |
| scherm                 | `fence`                                    | An amphibian fence along a road                                                                                                                                  |
| ronde                  | `round`                                    | Walking one transect once, from start to stop                                                                                                                    |
| waarneming             | `observation`                              | A counted animal or number of animals: in a round, at a bucket or in a drain                                                                                     |
| nulwaarneming          | (a `round` without observations)           | Effort with nothing found; always stored                                                                                                                         |
| losse waarneming       | `incidentalObservation`                    | A report outside a regular round, also by visitors without an account (later)                                                                                    |
| intekening             | `roundSignup`                              | An optional announcement "I will walk this transect around this time" (later)                                                                                    |
| aanmelding             | `membershipRequest`                        | A new volunteer asking to join a working group; a coordinator approves                                                                                           |
| maatregel              | `protectionMeasure`                        | A fence, bucket, fauna tunnel or escape device                                                                                                                   |
| soort                  | `species`                                  | Official species list, managed by admins                                                                                                                         |
| levend / dood          | `alive` / `dead`                           |                                                                                                                                                                  |
| onbekend               | `unknown`                                  | Unknown species (photo required), or a missing value in imported data                                                                                            |
| controlestatus         | `checkStatus`                              | When a transect, drain or bucket was last checked. Derived, never entered                                                                                        |
| veiligheidstoets       | `safetyTest`                               | Safety test a volunteer passes before checking drains; versioned, renewed yearly                                                                                 |
| bevoegdheid            | `safetyClearance`                          | The recorded result: test version, date and acceptance                                                                                                           |
| betrouwbaarheidsstatus | `verificationStatus`                       | Self-registered, checked by coordinator, confirmed by expert, unknown or uncertain                                                                               |
| weergave               | `viewMode`                                 | `beginner`, `standard` or `advanced`. How the input screen looks; not a permission                                                                               |
| rol                    | `role`                                     | What a user may do                                                                                                                                               |
| bezoeker               | `visitor`                                  | No account                                                                                                                                                       |
| vrijwilliger           | `volunteer`                                |                                                                                                                                                                  |
| coördinator            | `coordinator`                              | Per working group                                                                                                                                                |
| organisatiebeheerder   | `organizationAdmin`                        |                                                                                                                                                                  |
| hoofdbeheerder         | `platformAdmin`                            | PadVinder staff; manages all organizations                                                                                                                       |
| tik                    | `tap`                                      | One press on a count button                                                                                                                                      |

Keep these names as they are, untranslated: PadVinder, Paddentrek Enschede, Pad uit de put, RAVON.

### Naming

The glossary lists identifiers in camelCase. Adapt the casing to where the name is used:

| Where                                                                   | Convention                         | Example                        |
| ----------------------------------------------------------------------- | ---------------------------------- | ------------------------------ |
| TypeScript variables, functions and object keys; JSON fields in the API | camelCase                          | `drainCheck`, `observedAt`     |
| TypeScript types and React components                                   | PascalCase                         | `DrainCheck`, `DrainCheckForm` |
| Files and directories                                                   | kebab-case                         | `drain-check-form.tsx`         |
| Database tables                                                         | snake_case, plural                 | `drain_checks`                 |
| Database columns                                                        | snake_case                         | `observed_at`                  |
| URL paths, for the API and for pages                                    | kebab-case, plural for collections | `/drain-checks`                |

## Repository layout

One monorepo with pnpm workspaces.

```
apps/
  mobile/           PWA for volunteers, phone only (Vite, served under /app/)
  portal/           Web portal: administration (CMS), reports, later public results (Vite)
  api/              Fastify API, SSE, and the static builds of mobile and portal
  worker/           Background jobs; no HTTP
packages/
  contracts/        Zod schemas of the API contract; inferred types
  db/               Drizzle schema, client, migrations, seed, test database helper (@padvinder/db/testing)
  api-client/       openapi.json and the generated client (committed)
  ui/               Shared React components (Tailwind, shadcn/ui), Storybook; the map will live here too
infra/
  alwaysdata/       Provisioning and deploy scripts for Alwaysdata, and their README
  container/        Dockerfile of the release image
e2e/                Playwright tests
scripts/            Workspace setup and teardown, env loading, Vitest global setup
docs/               Repository settings on GitHub, design specs and plans
.github/            CI workflows, the shared setup action, Dependabot
```

Shared packages export TypeScript source, with no build step. Apps bundle: api and worker with tsdown (to `dist/main.js`), mobile and portal with Vite. A runtime dependency used by a bundled app must be a direct dependency of that app, with the same version as in the packages that use it. Each app is meant to be built separately; `pnpm release:build` bundles all four into one release (see "Release").

## Tech stack

Status is taken from the plan. **Decided** is settled: do not replace it without asking. **Proposed** is the working assumption. **Verify first** must be proven on Alwaysdata in the first sprint before features build on it.

### Frontend (mobile and portal)

| Area                     | Choice                                                                                                                                                                                                                                             | Status            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| App form                 | PWA with React and TypeScript, built with Vite. No Capacitor for now                                                                                                                                                                               | Decided           |
| PWA                      | `vite-plugin-pwa` for manifest and service worker; display `standalone`                                                                                                                                                                            | Decided           |
| Styling and components   | Tailwind with shadcn/ui                                                                                                                                                                                                                            | Decided           |
| Data layer               | Client generated from the OpenAPI description, with TanStack Query. SSE updates the query cache                                                                                                                                                    | Decided           |
| Routing                  | React Router                                                                                                                                                                                                                                       | Decided           |
| Maps                     | MapLibre GL JS through `react-map-gl`, OpenStreetMap as base map. Tile provider not yet chosen                                                                                                                                                     | Decided           |
| Drawing lines on the map | Terra Draw                                                                                                                                                                                                                                         | To try in slice 3 |
| Charts                   | ECharts. Not Recharts                                                                                                                                                                                                                              | Decided           |
| Session                  | httpOnly cookie, the same in mobile and portal                                                                                                                                                                                                     | Decided           |
| Tests                    | Vitest for logic and components, Playwright for whole screens                                                                                                                                                                                      | Decided           |
| Package manager          | pnpm                                                                                                                                                                                                                                               | Decided           |
| Lint and format          | Oxlint for linting, Oxfmt for formatting, for the whole monorepo. No ESLint, Prettier or Biome. Oxfmt was still in beta when this was chosen (February 2026); pin its version and review upgrades. Pinned: `oxlint` 1.94.0, `oxfmt` 0.79.0 (exact) | Decided           |

### Backend and hosting

| Area                     | Choice                                                                                                                                                                                               | Status       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Language and framework   | TypeScript 7 on Node.js 24 LTS (pinned in `.node-version`, `engines` and `devEngines`), with Fastify 5                                                                                               | Decided      |
| API                      | JSON over HTTP (REST-like), described with OpenAPI. The OpenAPI description is generated from the Zod schemas, never written by hand                                                                 | Decided      |
| Validation               | Zod 4                                                                                                                                                                                                | Decided      |
| Zod, Fastify and OpenAPI | `fastify-type-provider-zod` 7 with `@fastify/swagger`                                                                                                                                                | Decided      |
| API client generator     | `@hey-api/openapi-ts` 0.99.0 (exact, pre-1.0) with its TanStack Query plugin                                                                                                                         | Decided      |
| PostgreSQL driver        | `pg` (node-postgres; pg-boss needs it too, so one driver)                                                                                                                                            | Decided      |
| Shared packages          | TypeScript source, no build step per package                                                                                                                                                         | Decided      |
| Local HTTPS              | Optional: `pnpm dev:https` with a mkcert certificate                                                                                                                                                 | Decided      |
| Line geometry columns    | A custom Drizzle column type over GeoJSON, in slice 3                                                                                                                                                | Proposed     |
| Database                 | PostgreSQL with PostGIS; separate databases for production and staging                                                                                                                               | Decided      |
| Database access          | Drizzle ORM and Drizzle Kit `1.0.0-rc.6` (exact; 1.0 changes the migration folder format), migrations through Drizzle's runtime migrator. Raw SQL for PostGIS queries Drizzle cannot express         | Decided      |
| Authentication           | Better Auth 1.7 with the official Fastify integration (catch-all `/api/auth/*` route), email OTP plugin (one-time code by email), sessions in PostgreSQL, Drizzle adapter. For slice 1. No passwords | Decided      |
| Push                     | Web Push with the `web-push` library and our own VAPID key pair; subscriptions per device in PostgreSQL                                                                                              | Decided      |
| Hosting                  | Alwaysdata Plus Small (1 CPU, 1 GB RAM), production and staging on the same plan                                                                                                                     | Decided      |
| Source and CI            | GitHub with GitHub Actions; the repository is public                                                                                                                                                 | Decided      |
| Realtime                 | Server-Sent Events on the API, fed by PostgreSQL `LISTEN`/`NOTIFY`. Works locally; not yet verified on Alwaysdata                                                                                    | Verify first |
| Background jobs          | pg-boss in the worker service: cron, delayed jobs, retries                                                                                                                                           | Verify first |
| Processes                | Per environment two services: `padvinder-api` and `padvinder-worker`. They talk only through PostgreSQL                                                                                              | Verify first |
| Deployment               | CI builds one artifact with all dependencies, copies it with rsync over SSH, restarts the services through the Alwaysdata API. The same run builds a container image and smoke-tests it              | Proposed     |
| Files and photos         | On local disk, behind a storage interface with a disk driver and an S3 driver; access through the API with temporary links                                                                           | Proposed     |
| Email                    | SMTP through a transactional mail service (Lettermint or Brevo)                                                                                                                                      | Proposed     |
| Secrets                  | GitHub Actions Secrets, set as environment variables on the services                                                                                                                                 | Proposed     |
| Extra backups            | Hourly `pg_dump` to a second location during the season                                                                                                                                              | Proposed     |

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
- **App version** is CalVer `YYYY.N.P`, for example `2027.1.0`. The year is the migration season, not the release date: a release in December 2026 for the 2027 season is `2027.x`. The version lives in `apps/mobile/package.json`; `PADVINDER_APP_VERSION` overrides it. The build number is the CI run number, passed as `PADVINDER_BUILD_NUMBER` (default `dev`); it does not go into `PADVINDER_APP_VERSION`, which must be plain `YYYY.N.P` (the mobile build and dev server fail otherwise). The variable is not called `APP_VERSION` because Conductor sets that in its shells. Portal and API are identified by git commit.

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

| Capability            | Android (Chrome)                      | iPhone (Safari)                                                                                 |
| --------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Push notifications    | Yes, also without installing          | Only after installing to the home screen (iOS 16.4+), with permission requested after a tap     |
| Vibration             | Yes                                   | No. Use sound or a clear screen instead                                                         |
| Screen wake lock      | Yes                                   | Yes, in an installed PWA from iOS 18.4                                                          |
| Background sync       | Yes                                   | No. Buffered data is sent when the app is open again. Unused web data may be wiped after 7 days |
| Links open in the app | Yes, if installed                     | No, links open in Safari. Only a push notification opens the installed PWA                      |
| Install               | Own button triggers the system prompt | Manual through the share menu; the app explains with pictures                                   |
| Session after install | Kept                                  | Installed PWA has separate storage, so the user logs in again                                   |

Service worker, camera and push work only over HTTPS, also during local development.

## Development workflow

Needs Docker, and pnpm 12 (it downloads Node 24 by itself). Run commands from the repository root.

| Command                                                  | What it does                                                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./scripts/setup-workspace.sh`                           | One-time setup per workspace, safe to repeat: `pnpm install`, `.env`, shared database container, this workspace's databases, migrations, seed, Playwright Chromium.                                                 |
| `pnpm dev`                                               | API, worker, mobile and portal with hot reload, in one process group                                                                                                                                                |
| `pnpm dev:https`                                         | Same over HTTPS, for an iPhone on the local network (POSIX shells)                                                                                                                                                  |
| `pnpm check`                                             | Type check (also `scripts/`, `e2e/` and the root configs), Oxlint, Oxfmt check, `check:generated`, Vitest. **Every agent runs it before finishing**                                                                 |
| `pnpm check:generated`                                   | Regenerates the OpenAPI description, the client and the migrations in place and fails if that changed any file (review and commit the result). Part of `pnpm check`                                                 |
| `pnpm test:visual:docker`                                | Storybook visual tests, run in the Playwright Docker image (needs Docker)                                                                                                                                           |
| `pnpm screenshots:update`                                | Same, but rewrites the reference images in `packages/ui/src/__screenshots__`. The only way to make them                                                                                                             |
| `pnpm release:build`                                     | Builds everything into `release/` and `padvinder-release.tar.gz` (refuses a dirty tree; `--allow-dirty` for a local test)                                                                                           |
| `pnpm release:image`, `pnpm release:smoke`               | Build the container image `padvinder:local` from the tarball; start it against a fresh database and check `/api/health`, `/app/` and `/`                                                                            |
| `pnpm scan:secrets`, `pnpm lint:workflows`               | Gitleaks over the whole git history; actionlint (with shellcheck) over `.github/workflows` (both in Docker)                                                                                                         |
| `pnpm test`, `pnpm test:e2e`                             | Vitest only; Playwright (needs plain `pnpm dev`, not `dev:https`)                                                                                                                                                   |
| `pnpm infra:provision`, `infra:deploy`, `infra:services` | Plan or apply the Alwaysdata resources of an environment; deploy a release tarball; turn an environment's services on or off or restart them. Need the account's credentials; usage in `infra/alwaysdata/README.md` |
| `pnpm test:fake-host`                                    | `infra/alwaysdata` over SSH against a fake host container (needs Docker): `*.fake-host.test.ts`, not in `pnpm test`                                                                                                 |
| `pnpm format`                                            | Oxfmt writes (it also formats Markdown)                                                                                                                                                                             |
| `pnpm db:generate`, `db:migrate`, `db:seed`              | Create a migration after a schema change; apply migrations; seed made-up data                                                                                                                                       |
| `pnpm api:generate`                                      | Regenerate `openapi.json` and the client after any API schema change                                                                                                                                                |
| `pnpm storybook`, `pnpm build`                           | Storybook for `packages/ui`; production builds of the apps                                                                                                                                                          |
| `./scripts/teardown-workspace.sh`                        | Drops this workspace's databases (Conductor archive script)                                                                                                                                                         |

Details:

- **Per-workspace databases and ports.** One shared Compose project, `padvinder` (image `imresamu/postgis:18-3.6-bookworm`, host port 54329), serves all workspaces. Each workspace gets `padvinder_<workspace>` and `padvinder_<workspace>_test`, named after `CONDUCTOR_WORKSPACE_NAME`. Ports start at `CONDUCTOR_PORT` (default 4100): API B, mobile B+1, portal B+2, Storybook B+3. Setup writes `.env`; put overrides in `.env.local`. `.env.example` lists all variables. `ALLOWED_ORIGINS` is a comma-separated list of exact origins (no path, no trailing slash); production sets one.
- **Database.** Locale `C.UTF-8`; sort Dutch text with `COLLATE "nl-NL-x-icu"`. The migrations refuse a database whose encoding is not `UTF8` or whose `lc_collate`/`lc_ctype` is not `C.UTF-8`. Changing `POSTGRES_INITDB_ARGS` needs `docker compose down -v`. Only the core `postgis` extension. The image has the same major and minor versions as Alwaysdata, not the same patch versions: on 21 November 2026 it gave PostgreSQL 18.1 and PostGIS 3.6.1, Alwaysdata 18.7 and 3.6.2. `docker compose pull` updates it.
- **Tests.** Vitest projects; the root config loads env (real env, then `.env.local`, then `.env`) and prepares a test template database once per run. Each DB test file calls `createTestDatabase()` from `@padvinder/db/testing` in `beforeAll` and `await t?.drop()` in `afterAll`. Do not run two `pnpm test` at once in the same workspace. Component tests use jsdom and Testing Library; tests of the generated client need the helpers from `@padvinder/api-client/testing`. `pnpm test` skips the visual tests.
- **Visual tests.** Every story in `packages/ui` is rendered in Chromium and compared with a reference image (Vitest browser mode with `composeStories` and `toMatchScreenshot`; config `packages/ui/vitest.visual.config.ts`, not part of `pnpm test`). References are `packages/ui/src/__screenshots__/**/*-chromium-linux.png`. Only ever generate them with `pnpm screenshots:update`, which runs the pinned Playwright image (`mcr.microsoft.com/playwright:v1.65.1-noble`, amd64 like CI; emulated on Apple silicon) in Docker, never on the host: fonts and rendering differ per platform, and CI compares in the same image. Running `pnpm test:visual` on a Mac or Windows host makes ignored `-darwin.png` or `-win32.png` files and fails. The image tag must equal the exact `@playwright/test` and `playwright` versions; `scripts/playwright-version.test.ts` fails when they differ, so a Playwright upgrade also changes the tag (in `ci.yml` and `scripts/visual-tests.sh`) and needs new references. When a story changes on purpose, run `pnpm screenshots:update` and commit the images. When CI fails, the actual and diff images are in the `visual-diffs` artifact (locally: `packages/ui/.vitest/attachments`).
- **Release.** `pnpm release:build` writes `release/`, packed as `padvinder-release.tar.gz` (top-level `release/`). It contains `api/` and `worker/` (each with `dist/` and production `node_modules`), `mobile/` and `portal/` (the static builds), `migrations/` (the Drizzle folder), `release.env` (`GIT_COMMIT`, and `MOBILE_DIST_DIR` and `PORTAL_DIST_DIR`, which are relative and resolve against the working directory) and `release.json` (commit, app version, build). Start it from inside `release/`: `node --env-file=release.env --env-file=<secrets> api/dist/migrate.js migrations`, then `api/dist/main.js` and `worker/dist/main.js`. Variables already in the environment win over both files. The migrate command takes the migrations folder as its only argument. `infra/container/Dockerfile` builds the container image from the same directory (base `node:24-bookworm-slim`, Debian 12 like Alwaysdata); `scripts/smoke-test-image.sh` runs it against a database and checks health, the worker heartbeat and both front ends. The Vite builds need no dev ports.
- **CI.** See "CI". Docker images used by workflows and scripts are pinned by tag in the files themselves.
- **iPhone over HTTPS.** Run `mkcert -install` once first (interactive macOS prompt). Install and trust the mkcert root CA on the phone: send `rootCA.pem` from `mkcert -CAROOT` by AirDrop or email, install the profile, then enable full trust in Settings, General, About, Certificate Trust Settings. Open `https://<LAN IP>:<MOBILE_PORT>/app/`. Android over USB needs no HTTPS: forward the port in `chrome://inspect`.
- **App icon.** The one source is `packages/ui/assets/icon.svg` (the brand icon; do not redraw it). `apps/mobile/public/icon.svg` and `apps/portal/public/favicon.svg` are symlinks to it. The mobile PNG icons (maskable and Apple touch icons full-bleed in `#c8102e`) are generated at build time by `@vite-pwa/assets-generator` (`apps/mobile/pwa-assets.config.ts`). The portal is not a PWA, so its `favicon.ico` and `apple-touch-icon-180x180.png` are committed; after changing the source icon run `pnpm icons:generate` and commit the result.
- **Generated files.** Never edit them; regenerate. `packages/db/drizzle/**`: `pnpm db:generate`. `packages/api-client/openapi.json` and `src/generated/**`: `pnpm api:generate`. Commit both.
- **Toolchain notes.** `@hey-api/openapi-ts` 0.99.0 crashes on TypeScript 7, so `packages/api-client` has a devDependency `typescript@6.0.3` for generation only; its type check uses the root TypeScript 7. Revisit when hey-api supports TS 7, and then drop the Dependabot ignore of TypeScript majors in `.github/dependabot.yml`. Dependabot also ignores `@types/node` majors: the types follow the Node.js major in `.node-version`. pnpm 12 has a minimum release age: very new pinned packages need an exact-version entry in `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. `allowBuilds: { esbuild: false }` is deliberate. `@playwright/test` and `playwright` are pinned exactly and must match the Playwright image tag (a Vitest test checks this). The root `tsconfig.json` type-checks `scripts/`, `e2e/` and the root configs; it allows `.ts` import extensions because scripts run with plain `node`.
- **shadcn/ui.** After every `shadcn add`, rewrite `import { cn } from "cn"` to `../../lib/utils` and remove the `cn` npm package. Do not use `@/` imports (Vite does not resolve them). The generated Button is 36 px high; use the large size for touch targets.
- **Mobile app path.** Base and router basename are `/app/` (the trailing slash keeps "/" inside the PWA scope); manifest `id`, `start_url` and `scope` are `/app/`. Service worker registration lives in `apps/mobile/src/hooks`, once per page.

### Reference example: the health endpoint

Copy this slice when you add a feature; it touches every layer. `packages/contracts/src/health.ts` (Zod schema) -> `packages/db` (diagnostics, worker heartbeats) -> `apps/api/src/routes/health.ts` -> `openapi.json` -> `@padvinder/api-client` (`healthQueryOptions()`, `useHealthLiveUpdates()`) -> `packages/ui` `HealthStatus` with stories -> mobile "Meer" tab and portal `/system` -> `e2e/mobile-system-status.spec.ts`.

- Use `healthQueryOptions()`, not `getHealthOptions()`: a 503 with a degraded body is data, not an error.
- Realtime pattern: the worker sends `NOTIFY`, the API notification hub `LISTEN`s (with a `select 1` liveness check, and reconnects with capped backoff), `/api/events` streams SSE, and the client patches the TanStack Query cache and refetches when the stream (re)opens.
  - All live events go over one channel, `liveEventsChannel` (`live_events`, in `packages/db/src/notifications.ts`), whose payload is the `liveEventSchema` union in `packages/contracts/src/events.ts`. The `type` is the SSE event name; events that belong to an organization carry `organizationId`. To add an event:
    1. Add a union member in `packages/contracts/src/events.ts`.
    2. Call `notify(tx, liveEventsChannel, {...})` in the transaction that commits the change (it accepts no plain `db`, so nothing is sent on rollback). The payload must stay under 8000 bytes: send IDs, not records.
    3. Add a handler under `events` in `subscribeToServerEvents`.
  - A separate channel with `defineChannel(name, zodSchema)` is only for a different consumer; add it to `channels` in `apps/api/src/start-api.ts` too, otherwise `hub.subscribe` throws.
- `/api/events` is public and unscoped. Before it carries anything other than worker heartbeats, it must authenticate the session and filter events by organization (and working group where relevant).
- `/api/health` is public. Slice 1 limits its `database` details to platform admins.
- The species list is not in the skeleton.
- The idempotent-write pattern (client-generated UUIDv7; same ID twice gives one record) arrives in slice 1 with authentication; until then, no write endpoints.

### CI

GitHub Actions, `.github/workflows/ci.yml`, on every pull request and on `workflow_dispatch`. The job names are the required status checks (see `docs/repository-settings.md` for the repository settings, which the maintainer applies by hand):

- `check`: `pnpm check` against a PostGIS service container (includes the generated-files check).
- `visual`: the Storybook visual tests in the Playwright image. Failures upload `visual-diffs`.
- `e2e`: Playwright end-to-end tests against `pnpm dev`, in the Playwright image.
- `scan`: gitleaks over the whole history, and actionlint (`pnpm scan:secrets`, `pnpm lint:workflows`).
- `release / build` (the reusable `build-release.yml`): builds the release, builds the container image from the tarball, smoke-tests it, and uploads the tarball as artifact `release-<full commit sha>`. The deploy workflow calls it too and deploys that tarball.

A separate workflow, `.github/workflows/deploy-test.yml` (job `deploy-test`), runs only on pull requests that touch the deploy path (its `paths:` filter: `infra/`, the deploy workflows and action, the release build, the migrate and main entry points, `pnpm-lock.yaml`), and by hand. It builds its own release and runs `pnpm test:fake-host` with it (the deploy scripts over SSH against a fake host container), and runs the credentials action with a throwaway key. It is not a required check: a path-filtered workflow does not report on other pull requests, and a required check that never reports blocks the merge.

The CI and Deploy test workflows use no secrets. Only the deploy workflows (`deploy.yml`, `provision.yml`, `staging-services.yml`) do, through the GitHub environments `staging` and `production`. All workflows run with read-only permissions, and pin every action to a full commit SHA. Tools run as pinned Docker images from scripts in `scripts/`, so the same command works locally. Dependabot (`.github/dependabot.yml`) opens weekly update pull requests for npm, GitHub Actions and Docker files. It does not update the `container:` and `services:` images inside workflows: update those by hand (the Playwright tag together with the package, see "Visual tests").

### Workflow and deployment

- **Every change goes through a pull request and CI,** also with one developer. Short-lived branches from `main`.
- **Branch protection** on `main` requires the CI checks; see `docs/repository-settings.md`.
- **Do not install dependencies on the server.** The artifact contains everything.

#### Deployment

Merging to `main` builds one release and deploys it to staging; production follows after the maintainer approves it in the run. Only `main` deploys or provisions: both environments are on one Alwaysdata account, where every SSH user and API token reaches everything, so the GitHub environments `staging` and `production` allow the branch `main` only. A branch reaches staging only by merging it, or by the maintainer running the CLI locally. Migrations run on the server before the services restart; a failed health check switches back to the previous release. Provisioning (`pnpm infra:provision`, or the Provision workflow run by hand from `main`) makes the Alwaysdata sites, services, databases and SSH user, and writes the env file. Staging shares 1 GB of RAM with production and may be switched off (the Staging services workflow).

Everything else is in `infra/alwaysdata/README.md`: what runs where, the one-time GitHub and Alwaysdata setup, the first-run order, operating notes (rollback, rotating secrets, logs), DNS, rebuilding on another host, and the checklist of what is not yet verified. Update it in the same pull request when you change a deploy script, a workflow or an environment name.

### Tests

Every change has tests, with no exception for small changes. What that means depends on the change:

| Change                                    | Test it needs                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Logic, validation, calculations           | A Vitest unit test                                                                                                                                                                               |
| API endpoint                              | A test against a real PostgreSQL with PostGIS, not a mock: the success case, a rejected invalid request, and the permission cases below                                                          |
| Anything behind a permission              | A test for each role that may, one for a role that may not, and one showing that a user from another organization is denied. Where working groups matter, also a user from another working group |
| Endpoint that takes writes from the field | A test that sends the same ID twice and finds one record                                                                                                                                         |
| Export or download                        | A test that the output contains no volunteer names                                                                                                                                               |
| UI component                              | A Storybook story with fixture data, which is its visual test; a Vitest component test for behavior                                                                                              |
| Flow across several screens               | A Playwright test                                                                                                                                                                                |
| Bug fix                                   | A test that fails without the fix                                                                                                                                                                |
| Database migration                        | Run it against a database that already holds data in the old shape                                                                                                                               |

## Open technical points

Do not assume an answer to these; ask or leave a clear note. Settled by the skeleton: the Zod, Fastify and OpenAPI library, Better Auth with Fastify (slice 1), the Drizzle line column type approach (slice 3), and Oxlint/Oxfmt (Oxlint `correctness` category enabled as errors; type checking separate through `tsc`).

- Whether pg-boss, long-lived SSE connections and `LISTEN`/`NOTIFY` work reliably on Alwaysdata, and whether four processes fit in 1 GB. (pg-boss runs locally with a heartbeat job, and SSE and `LISTEN`/`NOTIFY` work locally; Alwaysdata behavior is unverified.)
- Terra Draw for drawing lines.
- Whether Oxfmt sorts Tailwind classes, and whether type-aware linting is worth its cost in CI.
- The OpenStreetMap tile provider, the second backup location, and the transactional mail service.
- The format and coordinate system of the municipality's drain data (GeoJSON, GeoPackage or CSV), which determine the importer.
- Accessibility requirements (possibly WCAG), and the visual identity (red, white and a little black; exact colors, logo and typography not yet set).
