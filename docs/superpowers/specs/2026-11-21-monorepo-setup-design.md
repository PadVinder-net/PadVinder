# Monorepo setup for development with AI

Date: 21 November 2026. Status: approved by the maintainer on 21 November 2026.

## Intent

The repository holds only documentation. Before slice 1 of the project plan can start, PadVinder needs a working monorepo that humans and AI agents can develop in: packages, local development, tests, CI and deployment.

The skeleton is the template for every slice that follows. Agents copy the patterns they find, so the skeleton must show each pattern once, correctly, end to end. That is why it goes beyond "hello world" in each app: one small feature runs through every layer, from the database to a screen, with its tests.

The deadline behind this: v1 (drains) must work on real phones in January 2027, and the first sprint also has to prove the "verify first" items on Alwaysdata. The setup has to be done quickly and must not need rework during the season (feature freeze around 1 February).

## Goals

- A pnpm monorepo with `apps/mobile`, `apps/portal`, `apps/api`, `apps/worker` and shared packages, each with working code.
- One vertical slice through every layer: PostgreSQL → Drizzle → Zod contract → Fastify route → OpenAPI → generated client → TanStack Query → a screen in mobile and portal → a UI component with a Storybook story → tests at each level.
- Local development with hot reloading for all four apps, Storybook, and PostgreSQL with PostGIS in Docker Compose.
- Several Conductor workspaces (git worktrees) can run at the same time without clashing on ports or databases.
- One command, `pnpm check`, that runs everything CI runs: type check, lint, format check, tests.
- CI on every pull request; deployment to staging on merge to `main`, to production after approval, with migrations before the restart.
- An idempotent provisioning script in `infra/alwaysdata/`.
- The first deployment answers the "verify first" questions about Alwaysdata (pg-boss, SSE through the proxy, `LISTEN`/`NOTIFY`, memory).
- AGENTS.md describes the real commands and paths, not the intended ones.

## Non-goals

- No domain features beyond the one slice. Accounts, roles, Better Auth, the safety test, drains: those are slices 1–5.
- No map yet (MapLibre comes with slice 3), no Terra Draw.
- No push notifications, no photo storage, no email.
- No offline mode (a project rule, not just for this setup).

## Anti-goals

What would make this a failure even if it technically works:

- Patterns in the skeleton that contradict AGENTS.md (a server-generated ID, a bare coordinate pair, a hand-written OpenAPI file, English UI copy). Agents would copy them.
- A setup that only works on the author's machine, or only in one worktree at a time.
- CI that is slower or flakier than it needs to be, so people stop trusting it.
- Extra services or SaaS beyond what AGENTS.md allows. No Turborepo remote cache, no hosted CI add-ons, no Redis.
- Secrets, real personal data or real locations in the public repository.

## Constraints

All of AGENTS.md applies. The ones that shape this work most:

- Node.js 24 LTS on the server. The local machine has Node 26, so the repo pins 24 (`.node-version` and `engines`). pnpm is not installed yet, and Node 25+ no longer ships Corepack: install pnpm on its own and pin it with the `packageManager` field.
- Lint and format only with Oxlint and Oxfmt. Pin the Oxfmt version (it is beta).
- PostgreSQL on port 5432 in production, not through pgBouncer. Fastify listens on `::`.
- API and worker talk only through PostgreSQL.
- The deploy artifact contains all dependencies; nothing is installed on the server.
- The repository is public.
- Conductor keeps its settings in the app, not in files in the repo. The repo gets a plain setup script; the Conductor repository setting only calls it. Each local Conductor workspace gets ten ports starting at `CONDUCTOR_PORT`, and its name in `CONDUCTOR_WORKSPACE_NAME`.

## Approaches

**How far the skeleton goes.** Considered:

1. _Hello world per app._ Each app starts and shows something. Quick, but every open library choice is pushed to slice 1, and the first agent to touch the API invents its own pattern.
2. _One vertical slice through every layer_ (chosen). Takes longer, forces the open library choices now, and gives agents one correct example of every layer to copy.
3. _A full slice 1 as the skeleton._ Too large, and mixes setup work with domain decisions (roles, permissions) that deserve their own design.

**Library choices.** Decided in the conversation of 21 November 2026, with versions from npm on that date:

| Area                     | Choice                                                                                                                                                                                             | Rejected alternative and why                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zod → Fastify → OpenAPI  | `fastify-type-provider-zod` 7 with `@fastify/swagger`                                                                                                                                              | `fastify-zod-openapi` 5.7: also good, a bit better at named components, but less used; ours builds on Zod 4's own JSON Schema conversion          |
| Client generator         | `@hey-api/openapi-ts` with its TanStack Query plugin, exact version pinned (pre-1.0)                                                                                                               | Orval: far larger output. `openapi-typescript` + `openapi-fetch`: types only, query keys by hand; we need stable query keys for SSE cache updates |
| Database access          | Drizzle ORM and Drizzle Kit 1.0 RC, exact version pinned                                                                                                                                           | 0.45 stable: 1.0 changes the migration folder format and the relations API; upgrading later would fall in the season                              |
| PostgreSQL driver        | `pg` (node-postgres)                                                                                                                                                                               | postgres.js: pg-boss needs `pg`, so one driver                                                                                                    |
| Shared packages          | Exported as TypeScript source, no build step per package                                                                                                                                           | Built packages: slower and more config; the deploy artifact bundles everything anyway                                                             |
| Test database            | Docker Compose locally, a service container in CI; each test file gets its own database cloned from a template                                                                                     | Testcontainers: slower, and extra containers next to parallel Conductor workspaces                                                                |
| Map                      | Lives in `packages/ui` when it comes (slice 3), not in a separate package                                                                                                                          | A separate `packages/map` to keep MapLibre out of `ui`: premature                                                                                 |
| Local HTTPS              | Optional (`pnpm dev:https` with a mkcert certificate). `localhost` is a secure context, so the laptop needs none; Android over USB with port forwarding needs none; only an iPhone over Wi-Fi does | Always HTTPS: friction for every developer and agent for one case                                                                                 |
| Better Auth with Fastify | The official integration (catch-all `/api/auth/*` route), Better Auth 1.7, email OTP plugin, Drizzle adapter. Not part of this work; recorded so slice 1 does not reopen it                        | The community `fastify-better-auth` plugin: small and unmaintained                                                                                |
| LineString columns       | A custom Drizzle column type over GeoJSON. Not part of this work; for slice 3                                                                                                                      |                                                                                                                                                   |

AGENTS.md lists these as open points; this work closes them and updates AGENTS.md.

## Design

### Repository layout

```
apps/
  api/            Fastify: REST API, OpenAPI, SSE, serves the mobile and portal builds
  worker/         pg-boss jobs; no HTTP
  mobile/         Vite + React PWA (phone only)
  portal/         Vite + React web portal
packages/
  contracts/      Zod schemas for the API contract; inferred types
  db/             Drizzle schema, database client, migrations, seed script
  api-client/     OpenAPI description and the client generated from it (committed)
  ui/             Shared React components (Tailwind, shadcn/ui), Storybook
  tsconfig/       Shared TypeScript configuration (or a root tsconfig.base.json; builder's call)
infra/
  alwaysdata/     Idempotent provisioning script (TypeScript) and README
scripts/          Workspace setup, database helpers
docker-compose.yml
```

`packages/db` is shared because both the API and the worker use the schema. The OpenAPI description is generated by starting the Fastify app without listening and writing its document to `packages/api-client/openapi.json`; hey-api then generates the client next to it. Both are committed, so a type check works without a running server, and CI fails if they are out of date (regenerate, then `git diff --exit-code`).

### Addresses and origins

One domain per environment, with the app under a path (decided 21 November 2026):

| Environment | Portal (later also the public results) | Mobile app (PWA)                     | API                                  |
| ----------- | -------------------------------------- | ------------------------------------ | ------------------------------------ |
| Production  | `https://padvinder.net/`               | `https://padvinder.net/app/`         | `https://padvinder.net/api/`         |
| Staging     | `https://staging.padvinder.net/`       | `https://staging.padvinder.net/app/` | `https://staging.padvinder.net/api/` |

Consequences the skeleton must get right from the start, because they are hard to change once volunteers have installed the app:

- The mobile build uses base path `/app/`; its manifest `start_url` and `scope` and its service worker scope are `/app/`, so the service worker never handles portal or API requests.
- The portal is served from `/`. Its React Router routes must never use `/app` or `/api`.
- The API serves the mobile build under `/app/` (falling back to its `index.html` for client-side routes), the portal build under `/` (with the same fallback), and its own routes under `/api/`.
- One origin per environment: the session cookie needs no `Domain` attribute, and the `Origin` check allows exactly that one origin.
- Locally, the same layout is reproduced: the mobile dev server runs with base `/app/`, and both dev servers proxy `/api`.

### The vertical slice: health and diagnostics

The slice is the health endpoint, `GET /api/health` (decided 21 November 2026, replacing an earlier proposal for a species list). It runs real database queries without needing any domain tables, so the skeleton makes no domain decisions that slice 1 would have to undo.

It reports:

- `status`: `ok`, or `degraded` when the database is unreachable or the worker heartbeat is stale. The HTTP status is 200 or 503, so deploy checks and the container smoke test can rely on it.
- `commit`: the git commit the API was built from.
- `database`: the PostgreSQL version, the PostGIS version, and the latest applied migration (name and time), read from Drizzle's migrations table.
- `worker`: the time of the last heartbeat (see below).

`GET /api/version` stays separate and reports the minimum app version; the app checks it on start.

The endpoint is public. PostgreSQL and PostGIS versions are low-risk to show, and the deploy check needs the endpoint without logging in. Once login exists, slice 1 may limit the `database` details to platform admins. _(Builder's call.)_

It touches every layer:

- `packages/db`: the heartbeat table (below) and its migration, the first Drizzle schema and migration in the repo; queries for the versions.
- `packages/contracts`: the Zod schema for the health response; types inferred from it.
- `apps/api`: the route, validated response, listed in OpenAPI; a test against real PostgreSQL that checks the versions and the latest migration, and the `degraded` case.
- `packages/api-client`: the generated client and query helpers.
- `packages/ui`: a `HealthStatus` component ("Systeemstatus") with Storybook stories for healthy, worker stale and database unreachable, using fixture data, and a Vitest component test.
- `apps/mobile` (on the Meer tab) and `apps/portal`: a screen that loads the health with TanStack Query and shows it, with Dutch copy, updated live by SSE.
- A Playwright test that opens the mobile Meer tab and sees the system status.

No seed data is needed: the migration creates the heartbeat table, Drizzle records the applied migration in its own table, and the worker writes the first heartbeat. The skeleton still includes an empty, idempotent seed script behind `pnpm db:seed`, called by the workspace setup script, so slice 1 only has to add data and agents know where it goes.

On a fresh database the status is `degraded` until the worker has written its first heartbeat. The Playwright test and the container smoke test either run the worker or wait for its first heartbeat.

The slice does not include a write endpoint: the idempotent-write pattern (client-generated UUIDv7, same ID twice gives one record) comes in slice 1, together with authentication, because an unauthenticated write endpoint would be open on staging. The builder writes a short note in AGENTS.md pointing at where that pattern will live.

### Worker and realtime

The worker starts pg-boss and runs one scheduled job, `heartbeat`, every minute. It records the time in a small table and sends `NOTIFY`.

The API has one SSE endpoint, `/api/events`, which listens with `LISTEN` and forwards heartbeat events. The client updates the health query in the TanStack Query cache from those events, so the system status shows the latest heartbeat without reloading. This is the realtime pattern later slices reuse for check status, and it is what the Alwaysdata verification needs.

### Configuration

Each app reads its environment once at startup and validates it with a Zod schema; a missing or invalid variable stops the process with a clear message. Local values come from a `.env` file written by the setup script; `.env.example` is committed.

### Local development

- `docker-compose.yml` runs PostgreSQL with PostGIS. The Compose project name is fixed, so all worktrees share one container. It listens on a non-default host port (to avoid clashing with a PostgreSQL already on the machine).
- Each worktree has its own database, named after the workspace (`padvinder_<workspace>`), and its own test template database. Outside Conductor the name falls back to the directory name.
- Ports come from `CONDUCTOR_PORT` when set (API, mobile, portal, Storybook each get one of the ten), and from fixed defaults otherwise.
- `scripts/setup-workspace.sh` (name is the builder's call) installs dependencies, writes `.env`, starts Compose if needed, creates the databases, runs migrations and the seed script. It is safe to run twice. Conductor's repository setup script calls it; a human runs it once after cloning.
- Vite proxies `/api` to the API in development, so the browser sees one origin, the same as in production.
- `pnpm dev` starts API and worker (with watch/restart) and both Vite dev servers, in one process group. Storybook has its own command.

### Scripts

Root `package.json` scripts, each running across workspaces with pnpm (no Turborepo):

| Script                                                | Does                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                            | All four apps with reloading                                                                               |
| `pnpm dev:https`                                      | The same, with a local certificate, for an iPhone over Wi-Fi                                               |
| `pnpm storybook`                                      | Storybook for `packages/ui`                                                                                |
| `pnpm check`                                          | Type check, Oxlint, Oxfmt check, all Vitest tests. What CI runs, and what an agent runs before it finishes |
| `pnpm test:e2e`                                       | Playwright                                                                                                 |
| `pnpm build`                                          | Builds all apps                                                                                            |
| `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed` | Drizzle Kit and the seed script (empty for now)                                                            |
| `pnpm api:generate`                                   | Writes the OpenAPI description and regenerates the client                                                  |
| `pnpm format`                                         | Oxfmt write                                                                                                |

### Tests

- Vitest throughout, configured as one workspace.
- API tests run against real PostgreSQL with PostGIS. Each test file clones a fresh database from the template, which holds the migrated schema; the template is rebuilt when migrations change.
- Storybook stories run as Vitest browser tests with screenshot comparison (`toMatchScreenshot`). Reference screenshots are generated inside the Playwright Docker image, never on a developer machine, so they match CI. A script runs that image locally to update them.
- Playwright for whole screens.

### CI (GitHub Actions)

On every pull request:

- `pnpm check`, with a PostGIS service container.
- Generated files up to date (OpenAPI and client).
- Storybook visual tests in the Playwright image.
- Playwright end-to-end tests.
- Secret scan (gitleaks).
- A build of the deploy artifact and the container image, with a smoke test: start the container against the service database and call `/api/health`.

Dependency updates through Dependabot (decided), for npm, GitHub Actions and the Docker images, grouped so they do not flood the pull request list. Branch protection on `main` requiring the checks; the builder documents the settings for the maintainer to apply, since they are repository settings.

### Deployment

On merge to `main`:

1. Build the artifact once: bundled API and worker, the mobile and portal builds, the migrations, and all runtime dependencies. Build the container image from the same artifact.
2. Deploy to staging: rsync the artifact over SSH into a new release directory, run the migrations on the server, switch the current release to the new directory, restart `padvinder-api` and `padvinder-worker` through the Alwaysdata API, then call `/api/health` and fail the run if it does not report the new commit and a recent worker heartbeat.
3. Deploy to production: the same steps, behind a GitHub environment that requires approval, and only for a commit that deployed to staging successfully.

**How migrations run:** on the server, over SSH, not from the CI runner. The artifact contains the migration files and a small migrate command that uses Drizzle's runtime migrator (`drizzle-orm`), so Drizzle Kit, a development tool, is not needed on the server. The project plan already says migrations run "on the server in the deploy step"; the rest is the builder's call, open to the maintainer's review. The CI job runs that command over SSH, from the new release directory, before switching and restarting. This way:

- the database never has to accept connections from GitHub's runners;
- the migrations run with the same code, Node version and database connection (port 5432) as the services;
- a failed migration stops the deploy before the switch, so the running version stays up. Because migrations are always additive first (two-step rule in AGENTS.md), the old code keeps working against the migrated database while the deploy finishes.

**Where the secrets live.** GitHub Actions Secrets are the source of truth, as the project plan says, per environment (GitHub environments `staging` and `production`). They reach the server only through provisioning, never through a deploy:

- The provisioning script runs as a manual GitHub workflow (or locally by the maintainer). It reads the secrets, sets the database user's password through the Alwaysdata API, and writes one environment file per environment over SSH, outside the release directories (for example `~/padvinder/production/.env`, mode 600).
- Both services and the migrate command read that file with Node's own `--env-file`. The secrets are therefore not stored in the Alwaysdata panel's service variables.
- A deploy needs only the SSH key and the Alwaysdata API key (to restart the services). It does not handle the database password.
- Rotating a secret means changing it in GitHub, running the provisioning workflow again, and restarting the services.

Staging may be switched off to save memory. The staging deploy starts its services if they are stopped, and a manual workflow stops them again. Whether staging stays on by default is decided after the memory measurement below. _(Builder's call.)_

The app version (CalVer `YYYY.N.P` plus the CI run number) is stamped into the mobile build; API and portal report the git commit.

### Provisioning (`infra/alwaysdata/`)

A small, idempotent TypeScript script that uses the Alwaysdata REST API to create or update, per environment: the site (reverse proxy to the API service, Let's Encrypt), the databases with PostGIS, the two services, environment variables, and SSH users. Running it twice changes nothing. A README lists every account, every manual step, and how to rebuild everything from scratch.

Each database gets only the `postgis` extension, not PostGIS Topology, PostGIS Raster or `earthdistance` (PostGIS `geography` already gives more accurate distances). Everything PadVinder needs is in the core extension: points and lines, distances in meters on `geography`, "within 15 m", clustering drains into routes (`ST_ClusterDBSCAN`), and transforming RD New (EPSG:28992) to WGS84 with `ST_Transform`. The migration's `CREATE EXTENSION IF NOT EXISTS postgis` is then a no-op on Alwaysdata, so the database user does not need the right to create extensions.

### Database locale

Every database, production, staging and local, uses encoding `UTF8` and locale `C.UTF-8` (decided 21 November 2026; Alwaysdata supports it). The locale is deterministic and does not depend on the operating system's glibc version, so a dump and restore to another host never changes sort order or invalidates an index. That keeps the "no vendor lock-in" rule. Local Compose initializes the server with `--encoding=UTF8 --locale-provider=builtin --locale=C.UTF-8`; databases created from `template1` and the test template inherit it.

`C.UTF-8` sorts by code point, so it does not sort Dutch text the way a reader expects. Where order is visible to users (species, working groups, transects), sort with `COLLATE "nl-NL-x-icu"` in the query or in the column definition, or in the client with `Intl.Collator("nl")`. Case-insensitive lookups (email, names) use `citext` or an index on `lower(...)`, not the locale. The database time zone stays UTC; day boundaries use Europe/Amsterdam explicitly, as AGENTS.md says.

DNS stays manual. `padvinder.net` and `staging.padvinder.net` already point at the Alwaysdata account; the README records the records as they are, so they can be recreated at another host.

### Alwaysdata verification

The first deployment to staging is also the test the plan asks for. The builder records the results in `infra/alwaysdata/README.md`:

- pg-boss runs the heartbeat every minute and comes back after Alwaysdata restarts the service.
- An SSE connection to `/api/events` stays open for an evening without buffering by the proxy.
- `LISTEN`/`NOTIFY` works on port 5432.
- The PostGIS version: answered on 21 November 2026. PostgreSQL 18.7 and PostGIS 3.6.2 (GEOS 3.11.1, PROJ 9.4.0) on Debian 12; the local image matches (`imresamu/postgis:18-3.6-bookworm`). (Note, 21 November 2026: it matches in major and minor version only. The pulled image gave PostgreSQL 18.1 and PostGIS 3.6.1; `docker compose pull` updates it.) Still open: whether the migrations can run with the database user's rights. On a playground database, `postgis_full_version()` reported "core procs need upgrade"; `postgis_extensions_upgrade()` failed for lack of rights, and turning the extension off and on did not help. Check this on the new production and staging databases; if it is still there, ask Alwaysdata support to run the upgrade.
- Whether the database accepts TLS connections from outside.
- The time zone of scheduled jobs.
- Memory use of the four processes (API and worker, production and staging).

## Order of work

Three pull requests, in this order:

1. **Skeleton and local development:** layout, packages, the vertical slice, worker heartbeat and SSE, configuration, Docker Compose, the workspace setup script, scripts, tests, Storybook, AGENTS.md updated.
2. **CI checks:** the pull request workflow, visual tests in the Playwright image, secret scan, artifact and container smoke test, dependency updates, documented branch protection.
3. **Deployment and provisioning:** `infra/alwaysdata/`, the deploy workflow for staging and production, the Alwaysdata verification and its results.

Pull request 3 needs the Alwaysdata API key, SSH access and the database credentials as GitHub secrets. The account, the domain and the DNS records exist.

## Follow-ups for slice 1

Decisions taken here that slice 1 has to act on:

- Limit the `database` details of `/api/health` (PostgreSQL, PostGIS and migration versions) to platform admins once login exists. Keep `status`, `commit` and the worker heartbeat public, because the deploy check and the smoke test need them without logging in.
- Add the idempotent-write pattern (client-generated UUIDv7, same ID twice gives one record) with its test, together with authentication, and replace the placeholder note in AGENTS.md with a pointer to it.
- Add the first seed data (made up) to the seed script.

## Left to the builder

- Exact file names, the tsconfig arrangement, and how scripts are split between root and packages.
- Watch tooling for API and worker (Node's own type stripping and `--watch`, or `tsx`).
- How the artifact is bundled (for example tsdown, or `pnpm deploy`), as long as the server installs nothing.
- Port assignment within the Conductor range, and the fixed defaults.
- The shadcn/ui setup inside `packages/ui`, and the Tailwind configuration shared by mobile and portal.
- The heartbeat table's shape, and how stale a heartbeat may be before the status is `degraded`.

## Open questions

None left for planning. The Alwaysdata account, the domain and DNS for `padvinder.net` and `staging.padvinder.net` exist (21 November 2026).

## Notes after implementation (21 November 2026)

- `ALLOWED_ORIGINS` is a comma-separated list of exact origins (development has the mobile and portal origins); production sets one.
- Storybook screenshot tests (`toMatchScreenshot` in the Playwright image) moved to pull request 2. The skeleton has stories and Vitest component tests only.
- `@hey-api/openapi-ts` 0.99.0 crashes on TypeScript 7. `packages/api-client` has a devDependency `typescript@6.0.3` for generation only; revisit when hey-api supports TS 7.
- pnpm 12's minimum release age needed exact-version entries in `minimumReleaseAgeExclude` for very new pinned packages (Drizzle, TanStack Query).
- No `infra/` directory, CI workflow or `packages/tsconfig` yet; a root `tsconfig.base.json` is used instead.
- 21 November 2026, pull request 2: the visual tests do not use Storybook's Vitest addon. They are a separate Vitest browser project in `packages/ui` (`vitest.visual.config.ts`) that renders each story with `composeStories` and calls `toMatchScreenshot`. It is not in `pnpm test`; `pnpm test:visual` runs in the Playwright image (`pnpm test:visual:docker`), and references change only through `pnpm screenshots:update`.
- 21 November 2026: the release check is named `release / build`, not `release`: a job that calls a reusable workflow reports as `<caller job> / <called job>`.
- 21 November 2026: the Vite builds of mobile and portal no longer need dev ports, and `MOBILE_DIST_DIR` and `PORTAL_DIST_DIR` may be relative (resolved against the working directory). The migrate command takes the migrations folder as an argument, which settles the `import.meta.dirname` question of pull request 1.
- 21 November 2026: `pnpm check` now includes `pnpm check:generated`, which regenerates in place and compares file contents before and after (not git), and the root `tsconfig.json` type-checks `scripts/`, `e2e/` and the root configs.
- 21 November 2026: Dependabot's `github-actions` entry also lists `/.github/actions/*`, because `/` covers only the workflows. It does not update `container:` or `services:` images in workflows. No `.gitleaks.toml` was needed.
- 21 November 2026: the container image is smoke-tested in the `release` job against the same PostGIS service as `check`, through `host.docker.internal`.
- 22 November 2026, pull request 3 (deployment and provisioning, see `infra/alwaysdata/README.md`): a deploy that fails its health check, or its restart, switches `current` back to the previous release and waits for that release's health. The run still fails, and says whether the rollback worked. Migrations are not undone.
- 22 November 2026: `workflow_dispatch` only works for a workflow file on the default branch, so the first runs need push triggers: `provision/<env>` (plan and inspect only, read-only) and `staging/**` (deploys that branch to staging, also a way to test a branch). Both are deployment branch rules of the GitHub environments. Removed again the same day, before the first run: see the note "staging only from `main`" below. The first runs now happen after the merge.
- 22 November 2026: the env file on the server also holds the non-secret per-environment settings (`API_HOST`, `API_PORT`, `ALLOWED_ORIGINS`, `LOG_LEVEL`), next to `DATABASE_URL`. The Alwaysdata services' own environment holds only `NODEJS_VERSION=24`.
- 22 November 2026: the Alwaysdata API has no field for SSH keys, so the deploy public key is added to the SSH user in the panel by hand, between the first and the second provisioning apply. Changed the same day: the key goes on the account's main SSH user before the first apply, and there is no second apply (see the note "deploy as the main SSH user" below).
- 22 November 2026: Alwaysdata restarts a service with `SIGHUP`. The API and the worker shut down cleanly on it. Services run on servers other than the SSH server, so processes and memory are read in the panel.
- 22 November 2026: the build number reaches the apps as `PADVINDER_BUILD_NUMBER`, set to the workflow run number by the deploy workflow.
- 22 November 2026: the production job skips (and shows green, with a notice) when its commit is no longer the head of `main` at approval time, so an old approval cannot put an older release live. A manual rollback is a revert on `main`.
- 22 November 2026: changing `DATABASE_PASSWORD` needs the explicit `rotate-password` flag at two layers (the workflow input and the CLI), so the env file and the database user cannot disagree by accident. Provisioning, Staging services and the deploy jobs of one environment share one concurrency group.
- 22 November 2026: `pnpm test:fake-host` runs in CI as the job `deploy-test`, a required check. Changed the same day: the job moved to its own workflow, `deploy-test.yml`, which runs only on pull requests that touch the deploy path (a `paths:` filter) and by hand, so the other pull requests do not pay for a second release build and a fake host. It is no longer a required check, because a path-filtered workflow does not report on other pull requests and a required check that never reports blocks the merge. It also runs the credentials action with a throwaway key and checks that the agent holds one key, that the key is not in the agent's environment or on disk, and that the final step stops the agent.
- 22 November 2026: the deploy key reaches OpenSSH through `ssh-agent`, not a key file, so it never touches the runner's disk. The action `alwaysdata-credentials` starts a dedicated agent (socket `$RUNNER_TEMP/ssh-agent.sock`), loads `DEPLOY_SSH_KEY` over stdin with a one-hour lifetime, and exports `SSH_AUTH_SOCK` and `SSH_AGENT_PID`; the last step of each job stops the agent. ssh gets `IdentityAgent=<socket>` with `IdentityFile=none` and `IdentitiesOnly=no`: with `IdentitiesOnly=yes` and no `IdentityFile`, OpenSSH (9.6 and 10.3 tried) offers no agent key at all, and offers the default `~/.ssh/id_*` files instead. Local runs may still use `DEPLOY_SSH_KEY_FILE`, which wins over `SSH_AUTH_SOCK`.
- 22 November 2026, after review: the agent starts without `DEPLOY_SSH_KEY` and `SSH_KNOWN_HOSTS` in its environment (it outlives the step, and `/proc/<pid>/environ` would show the key), and only `ssh-add` gets the key, over a pipe. The action now exports `DEPLOY_SSH_AGENT_SOCK` and `DEPLOY_SSH_AGENT_PID` instead of `SSH_AUTH_SOCK` and `SSH_AGENT_PID`, and the scripts read `DEPLOY_SSH_AGENT_SOCK` (or `DEPLOY_SSH_KEY_FILE`), never `SSH_AUTH_SOCK`, so a local run cannot silently use the maintainer's personal agent. Setting `DEPLOY_SSH_AGENT_SOCK="$SSH_AUTH_SOCK"` stays possible on purpose.
- 22 November 2026, staging only from `main` (the maintainer's decision): both environments are on one Alwaysdata account, where every SSH user and every API token reaches everything, so whoever can run code in the GitHub environment `staging` can read production's secrets. The account is the security boundary, and staging is treated as production-sensitive: only reviewed code on `main` may hold the deploy credentials. Both GitHub environments allow the branch `main` only. Deploy runs on a push to `main` and by hand (its deploy jobs skip off `main`); Provision runs by hand only. The `staging/**` and `provision/<env>` push triggers of the note above are gone, and with them deploying a branch to staging from GitHub: a branch reaches staging by merging it, or by the maintainer running the CLI locally. The first run starts with the merge of pull request 8, whose Deploy run fails safely (no services found, nothing changed); the order is in `infra/alwaysdata/README.md`.
- 22 November 2026, deploy as the main SSH user (the maintainer's decision): provisioning no longer creates SSH users, although the "Provisioning" section above lists them, and the services set no `ssh_user`. Provisioning and deploys log in as the account's main SSH user, which Alwaysdata creates with the account and names after it (`<account>` on `ssh-<account>.alwaysdata.net`); the earlier dedicated user `<account>_deploy` is gone. Alwaysdata SSH users are not chrooted, so every SSH user reaches the whole account and a separate deploy user isolates nothing. Alwaysdata also warns that several SSH users cause file-rights problems, errors when accessing and deleting files ([SSH troubleshooting, rights](https://help.alwaysdata.com/en/docs/web-hosting/remote-access/ssh/troubleshooting/#rights)), and sites run as the main user. So the releases, `current` and the env files belong to the main user, like everything else on the account. Because the main user exists from the start, provisioning now reads the env file and checks its password before any change through the API also on the first run, and writes the env file in that same first apply; the deploy public key goes on the main user before it. That a service without `ssh_user` runs as the main user is unverified until the first inspect and deploy.
