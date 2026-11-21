# Monorepo Skeleton and Local Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pull request 1 of the monorepo setup: a pnpm monorepo with four apps and shared packages, one vertical slice (`GET /api/health` with worker heartbeat and live updates) through every layer, and local development that works in several Conductor workspaces at once.

**Architecture:** Shared packages export TypeScript source (no build step). Zod schemas in `packages/contracts` drive Fastify validation, the generated OpenAPI description and the generated hey-api client. The worker writes a heartbeat through pg-boss and `NOTIFY`; the API forwards it over SSE; the client patches the TanStack Query cache. One shared PostGIS container serves a database per workspace.

**Tech Stack:** Node 24, pnpm 12, TypeScript 7, Fastify 5, Zod 4, fastify-type-provider-zod 7, Drizzle ORM 1.0 RC, pg, pg-boss 12, Vite 8, React 19, React Router 8, TanStack Query 5, hey-api openapi-ts, Tailwind 4, shadcn/ui, Storybook 10, Vitest 5, Playwright, Oxlint, Oxfmt.

**Spec:** `docs/superpowers/specs/2026-11-21-monorepo-setup-design.md` (read it, and `AGENTS.md`, before starting any task).

## Global Constraints

- AGENTS.md applies in full: English code, Dutch UI copy with "je", English kebab-case URL paths, glossary terms, naming conventions per location.
- Pin these exact versions (npm, 21 November 2026): `typescript@7.0.2`, `pnpm@12.21.0` (in `packageManager`), `fastify@5.12.8`, `fastify-type-provider-zod@7.0.0`, `@fastify/swagger@9.9.5`, `@fastify/static@10.1.12`, `zod@4.6.7`, `@hey-api/openapi-ts@0.99.0`, `drizzle-orm@1.0.0-rc.6`, `drizzle-kit@1.0.0-rc.6`, `pg@8.23.1`, `pg-boss@12.38.2`, `vite@8.3.8`, `vite-plugin-pwa@2.0.0`, `react@19.3.1`, `react-dom@19.3.1`, `react-router@8.5.2`, `@tanstack/react-query@5.108.2`, `tailwindcss@4.3.5`, `@tailwindcss/vite@4.3.5`, `storybook@10.6.8`, `@storybook/react-vite@10.6.8`, `vitest@5.1.1`, `@playwright/test@1.65.1`, `tsdown@0.23.7`, `tsx@4.23.15`, `oxlint@1.94.0`, `oxfmt@0.79.0`. Use exact versions (no `^`) for hey-api, Drizzle, Oxlint and Oxfmt; caret ranges are fine for the rest.
- These versions are newer than the plan author's knowledge. Where the plan names a library API (option names, import paths, generated function names), it states the intent; check the installed version's documentation and keep our own names and signatures exactly as given here.
- Node 24 for all scripts, even though the machine has Node 26: `.node-version` contains `24`, root `package.json` has `"engines": { "node": ">=24 <25" }` and `devEngines.runtime` `{ "name": "node", "version": "24", "onFail": "download" }` so pnpm runs scripts on Node 24.
- Package names: `@padvinder/contracts`, `@padvinder/db`, `@padvinder/api-client`, `@padvinder/ui`, `@padvinder/api`, `@padvinder/worker`, `@padvinder/mobile`, `@padvinder/portal`. All `"private": true`, `"type": "module"`. Shared packages export source: `"exports": { ".": "./src/index.ts" }` plus subpaths named in tasks.
- One root `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `module: "preserve"`, `moduleResolution: "bundler"`, `target: "es2024"`, `noEmit`, `skipLibCheck`. Imports are extensionless. Each package has a `tsconfig.json` that extends it and a `typecheck` script (`tsc --noEmit`).
- API and worker run in development with `tsx watch` and Node's `--env-file-if-exists` flags for `../../.env` then `../../.env.local` (later overrides earlier). They build with tsdown into `dist/main.js`, bundling `@padvinder/*` and leaving `node_modules` dependencies external.
- Generated files are committed and excluded from Oxlint and Oxfmt: `packages/api-client/openapi.json`, `packages/api-client/src/generated/**`, `packages/db/drizzle/**`. Never edit them by hand.
- Database image: `imresamu/postgis:18-3.6-bookworm`, matching Alwaysdata (PostgreSQL 18.7, PostGIS 3.6.2 on Debian 12, checked 21 November 2026). Multi-arch; the official `postgis/postgis` image has no arm64 build.
- Database locale: encoding `UTF8`, locale `C.UTF-8` everywhere (see the spec, "Database locale"). Locally this is set at server initialization, so it only applies to a fresh volume. User-visible Dutch sorting uses `COLLATE "nl-NL-x-icu"`, never the database default.
- Local database server: host port `54329`, user `padvinder`, password `padvinder` (local only, not a secret). Databases per workspace: `padvinder_<workspace>` and template `padvinder_<workspace>_test`. `<workspace>` is `CONDUCTOR_WORKSPACE_NAME`, or the repository directory name, lowercased with every non `[a-z0-9]` character replaced by `_`.
- Ports: base `B` = `CONDUCTOR_PORT` or `4100`. API `B`, mobile `B+1`, portal `B+2`, Storybook `B+3`.
- Environment variables (names exact): `WORKSPACE`, `DATABASE_URL`, `TEST_DATABASE_URL`, `API_PORT`, `API_HOST` (default `::`), `MOBILE_PORT`, `PORTAL_PORT`, `STORYBOOK_PORT`, `ALLOWED_ORIGINS` (comma-separated), `GIT_COMMIT` (default `dev`), `MIN_APP_VERSION` (default `2027.0.0`), `APP_VERSION` (mobile build, default `2027.0.0`), `MOBILE_DIST_DIR`, `PORTAL_DIST_DIR` (optional), `LOG_LEVEL` (default `info`), `DEV_HTTPS` (optional, `1`).
- Every moment crosses the API as ISO 8601 with offset (`z.iso.datetime({ offset: true })`), and is shown to users in `nl-NL` with time zone `Europe/Amsterdam`.
- Commit after every task with a message in English; end each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The database hangs or is down.** `/api/health` must answer within a few seconds with 503 and `database.reachable: false`, never hang or crash. Pinned by the "unreachable database" test in Task 6 and the pool timeouts in Task 3.
2. **The LISTEN connection drops** (Alwaysdata restart, network blip) during an evening-long SSE session. The hub must reconnect and keep delivering events. Pinned by the "reconnects after the listener is terminated" test in Task 7.
3. **A refresh or deep link under `/app/`** (for example `/app/more`) must get the app's `index.html`, while a missing asset (`/app/assets/missing.js`) must get 404, not HTML that a service worker would cache as script. Pinned by Task 8's static tests.
4. **Live events arrive out of order, malformed, or after a reconnect.** The cached health must never move backwards or break. Pinned by Task 9's `applyWorkerHeartbeat` and `subscribeToServerEvents` tests.
5. **Several test projects or workspaces at once.** Cloning from the template must not fail with "source database is being accessed by other users", and two workspaces must not share a database. Pinned by Task 4's concurrent-clone test and Task 2's two-workspace run.

---

### Task 1: Workspace root and `packages/contracts`

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `.node-version`, `.npmrc`, `tsconfig.base.json`, `.oxlintrc.json`, `.oxfmtrc.json` (and its ignore list), `.gitignore`, `.editorconfig`, `vitest.config.ts`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`, `src/health.ts`, `src/version.ts`, `src/events.ts`, `src/fixtures/health.ts`
- Test: `packages/contracts/src/health.test.ts`, `src/version.test.ts`, `src/fixtures/health.test.ts`

**Interfaces:**

- Produces (from `@padvinder/contracts`):
  - `overallStatusSchema = z.enum(["ok", "degraded"])`, `type OverallStatus`
  - `HEARTBEAT_STALE_AFTER_MS = 180_000`
  - `deriveOverallStatus(input: { databaseReachable: boolean; lastHeartbeatAt: Date | null; now: Date }): OverallStatus`
  - `healthResponseSchema` (registered as OpenAPI component `HealthResponse` via `.meta({ id: "HealthResponse" })`), `type HealthResponse`:
    `{ status: OverallStatus; commit: string; checkedAt: string; database: { reachable: boolean; postgresVersion: string | null; postgisVersion: string | null; latestMigration: { name: string; createdAt: string } | null }; worker: { lastHeartbeatAt: string | null } }`
  - `calVerSchema` (regex `^\d{4}\.\d+\.\d+$`), `compareCalVer(a: string, b: string): -1 | 0 | 1` (throws on invalid input)
  - `versionResponseSchema` (component `VersionResponse`), `type VersionResponse = { minimumAppVersion: string; commit: string }`
  - `SSE_EVENT_WORKER_HEARTBEAT = "worker-heartbeat"`, `workerHeartbeatEventSchema`, `type WorkerHeartbeatEvent = { beatAt: string }`
- Produces (from `@padvinder/contracts/fixtures`): `healthyFixture`, `workerStaleFixture`, `databaseUnreachableFixture` (each a `HealthResponse`, `commit: "0123456789abcdef"`, `checkedAt: "2027-03-01T19:31:00.000Z"`; the healthy heartbeat is `"2027-03-01T19:30:00.000Z"`, PostgreSQL `"18.7"`, PostGIS `"3.6.2"`, migration `{ name: "0001_worker_heartbeats", createdAt: "2026-11-21T10:00:00.000Z" }`).

- [ ] **Step 1: Install pnpm and create the root tooling.** If `pnpm` is missing, run `npm install -g pnpm@12.21.0`. Root `package.json` scripts: `typecheck` (`pnpm -r typecheck`), `lint` (`oxlint`), `format` (`oxfmt .`), `format:check` (`oxfmt --check .`), `test` (`vitest run`), `check` (`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`). Root `vitest.config.ts` uses Vitest projects over `packages/*` and `apps/*`. `pnpm-workspace.yaml` lists `apps/*` and `packages/*`. `.gitignore` covers `node_modules`, `dist`, `.env`, `.env.local`, `storybook-static`, `test-results`, `playwright-report`, `*.local.*`, `.certs`.

- [ ] **Step 2: Verify the toolchain.** Run `pnpm install && pnpm exec node --version`. Expected: `v24.x`.

- [ ] **Step 3: Write the failing tests.**

```ts
// health.test.ts
const now = new Date("2027-03-01T19:31:00Z");
test("degraded without any heartbeat", () =>
  expect(deriveOverallStatus({ databaseReachable: true, lastHeartbeatAt: null, now })).toBe(
    "degraded",
  ));
test("degraded when the database is unreachable", () =>
  expect(deriveOverallStatus({ databaseReachable: false, lastHeartbeatAt: now, now })).toBe(
    "degraded",
  ));
test("ok when the heartbeat is 2:59 old", () =>
  expect(
    deriveOverallStatus({
      databaseReachable: true,
      lastHeartbeatAt: new Date(now.getTime() - 179_000),
      now,
    }),
  ).toBe("ok"));
test("degraded when the heartbeat is 3:01 old", () =>
  expect(
    deriveOverallStatus({
      databaseReachable: true,
      lastHeartbeatAt: new Date(now.getTime() - 181_000),
      now,
    }),
  ).toBe("degraded"));
test("ok when the heartbeat is slightly in the future (clock skew)", () =>
  expect(
    deriveOverallStatus({
      databaseReachable: true,
      lastHeartbeatAt: new Date(now.getTime() + 5_000),
      now,
    }),
  ).toBe("ok"));

// version.test.ts
test("compares numerically, not as text", () =>
  expect(compareCalVer("2027.10.0", "2027.9.0")).toBe(1));
test("older year is lower", () => expect(compareCalVer("2026.5.3", "2027.0.0")).toBe(-1));
test("equal", () => expect(compareCalVer("2027.1.0", "2027.1.0")).toBe(0));
test("rejects non-CalVer input", () => expect(() => compareCalVer("1.2", "2027.0.0")).toThrow());

// fixtures/health.test.ts
test.each([healthyFixture, workerStaleFixture, databaseUnreachableFixture])(
  "fixture matches the schema",
  (f) => expect(healthResponseSchema.parse(f)).toEqual(f),
);
test("databaseUnreachableFixture has no versions", () => {
  expect(databaseUnreachableFixture.database).toMatchObject({
    reachable: false,
    postgresVersion: null,
    postgisVersion: null,
    latestMigration: null,
  });
});
```

- [ ] **Step 4: Run them.** `pnpm test packages/contracts`. Expected: FAIL, modules not found.

- [ ] **Step 5: Implement the schemas, functions and fixtures** with the signatures above. `deriveOverallStatus`: `ok` only if the database is reachable and `now - lastHeartbeatAt <= HEARTBEAT_STALE_AFTER_MS`.

- [ ] **Step 6: Run the whole check.** `pnpm check`. Expected: PASS (typecheck, lint, format, tests).

- [ ] **Step 7: Commit.** `git commit -m "Set up the pnpm workspace and the contracts package"`

---

### Task 2: Docker Compose and the workspace scripts

**Files:**

- Create: `docker-compose.yml`, `.env.example`, `scripts/setup-workspace.sh`, `scripts/teardown-workspace.sh`, `scripts/lib/workspace-env.sh`

**Interfaces:**

- Produces: a `.env` at the repository root with every variable from Global Constraints for this workspace; databases `padvinder_<workspace>` and `padvinder_<workspace>_test` on the shared container.
- Consumes (in later tasks, called by setup): `pnpm db:migrate`, `pnpm db:seed` (Task 3), `pnpm exec playwright install chromium` (Task 13). Until those exist, setup skips a step whose script is missing and prints that it did.

- [ ] **Step 1: Write `docker-compose.yml`.** Top-level `name: padvinder` (fixed, so all worktrees share it), service `db` with image `imresamu/postgis:18-3.6-bookworm`, port `54329:5432`, user/password/database `padvinder`, a named volume, and a `pg_isready` health check. Set `POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale-provider=builtin --locale=C.UTF-8"`. It only takes effect on an empty data volume, so an existing volume must be removed (`docker compose down -v`) to pick it up. Verify with `SELECT datcollate, datctype, datlocprovider, pg_encoding_to_char(encoding) FROM pg_database WHERE datname = 'padvinder';` (expect `C.UTF-8`, `C.UTF-8`, `b`, `UTF8`), and that `SELECT 'a' COLLATE "nl-NL-x-icu"` works (ICU is available).

- [ ] **Step 2: Write `scripts/lib/workspace-env.sh`.** Exports `WORKSPACE` (sanitized as in Global Constraints) and the four ports from `CONDUCTOR_PORT` or `4100`. Sourced by both scripts.

- [ ] **Step 3: Write `scripts/setup-workspace.sh`** (bash, `set -euo pipefail`, safe to run twice): install pnpm `12.21.0` if missing; `pnpm install --frozen-lockfile`; write `.env` (always regenerated; first line `# Generated by scripts/setup-workspace.sh. Put overrides in .env.local.`) with `DATABASE_URL`, `TEST_DATABASE_URL`, ports, and `ALLOWED_ORIGINS=http://localhost:<mobile>,http://localhost:<portal>`; `docker compose up -d --wait db`; create both databases if missing (via `docker compose exec -T db psql`); run `pnpm db:migrate`, `pnpm db:seed`; `pnpm exec playwright install chromium`. `.env.example` documents every variable with the default-workspace values.

- [ ] **Step 4: Write `scripts/teardown-workspace.sh`.** Drops this workspace's two databases (and any leftover `padvinder_<workspace>_test_*` clones). Leaves the container running.

- [ ] **Step 5: Verify idempotence and isolation.** Run `scripts/setup-workspace.sh` twice, then `CONDUCTOR_WORKSPACE_NAME=other-ws CONDUCTOR_PORT=4200 scripts/setup-workspace.sh` from a scratch copy (`git worktree add /tmp/pv-other`). Expected: both runs succeed; `docker compose exec db psql -U padvinder -Atc "select datname from pg_database where datname like 'padvinder_%' order by 1"` lists `padvinder_<this>`, `padvinder_<this>_test`, `padvinder_other_ws`, `padvinder_other_ws_test`; the two `.env` files have different ports and database names. Then run teardown in `/tmp/pv-other`, remove that worktree, and check its databases are gone.

- [ ] **Step 6: Commit.** `git commit -m "Add Docker Compose and per-workspace setup scripts"`

---

### Task 3: `packages/db`: schema, migrations, queries

**Files:**

- Create: `packages/db/package.json`, `tsconfig.json`, `drizzle.config.ts`, `vitest.config.ts`, `src/index.ts`, `src/client.ts`, `src/schema/index.ts`, `src/schema/worker-heartbeats.ts`, `src/heartbeats.ts`, `src/diagnostics.ts`, `src/migrate.ts`, `src/seed.ts`, `src/cli/migrate.ts`, `src/cli/seed.ts`
- Create (generated): `packages/db/drizzle/**`
- Modify: root `package.json` (scripts `db:generate`, `db:migrate`, `db:seed` delegating to `@padvinder/db`)
- Test: `packages/db/src/heartbeats.test.ts`, `src/diagnostics.test.ts`, `src/migrate.test.ts`

**Interfaces:**

- Consumes: `WorkerHeartbeatEvent` shape from Task 1 (the `NOTIFY` payload is `JSON.stringify({ beatAt: <ISO> })`).
- Produces (from `@padvinder/db`):
  - `type Db` (Drizzle node-postgres database with our schema), `createDb(databaseUrl: string): { db: Db; pool: pg.Pool }`. The pool sets `connectionTimeoutMillis: 2_000`, `statement_timeout: 5_000` and `application_name: "padvinder"`.
  - `workerHeartbeats` table: `worker_heartbeats (beat_at timestamptz primary key)`. A comment on the table says: system table written by the worker, keyed by time; tables for registrations from the field use a client-generated UUIDv7 primary key (AGENTS.md).
  - `WORKER_HEARTBEAT_CHANNEL = "worker_heartbeat"`
  - `recordHeartbeat(db: Db, beatAt?: Date): Promise<Date>`: in one transaction, inserts the beat (ignoring a duplicate time), deletes beats older than 7 days, and calls `pg_notify(WORKER_HEARTBEAT_CHANNEL, payload)`.
  - `getLatestHeartbeat(db: Db): Promise<Date | null>`
  - `type DatabaseDiagnostics = { postgresVersion: string; postgisVersion: string | null; latestMigration: { name: string; createdAt: Date } | null }`, `getDatabaseDiagnostics(db: Db): Promise<DatabaseDiagnostics>`: `current_setting('server_version')`; `postgis_lib_version()` only if the extension exists (`pg_extension`), else `null`; the newest row of Drizzle's migrations table.
  - `runMigrations(databaseUrl: string, migrationsFolder?: string): Promise<void>` using Drizzle's runtime migrator from `drizzle-orm` (not Drizzle Kit). The default folder is `packages/db/drizzle`, resolved from `import.meta.dirname`.
  - `seed(db: Db): Promise<void>`: idempotent, does nothing yet. A comment says slice 1 adds made-up seed data here.
- Scripts in `packages/db/package.json`: `db:generate` (`drizzle-kit generate`), `db:migrate` (`tsx --env-file-if-exists=../../.env --env-file-if-exists=../../.env.local src/cli/migrate.ts`), `db:seed` (same for `src/cli/seed.ts`).

- [ ] **Step 1: Write `drizzle.config.ts`.** PostgreSQL dialect, schema `./src/schema/index.ts`, out `./drizzle`, `schemaFilter: ["public"]` (keeps pg-boss's schema out), `extensionsFilters: ["postgis"]`, credentials from `DATABASE_URL`.

- [ ] **Step 2: Generate the migrations in this order.** `pnpm --filter @padvinder/db exec drizzle-kit generate --custom --name enable_postgis`, then fill it with `CREATE EXTENSION IF NOT EXISTS postgis;`. Then write the `workerHeartbeats` schema and run `drizzle-kit generate --name worker_heartbeats`.

- [ ] **Step 3: Check the migrations table.** Run `pnpm db:migrate` after implementing `runMigrations` and `src/cli/migrate.ts`, then `docker compose exec db psql -U padvinder -d padvinder_<workspace> -c '\d drizzle.__drizzle_migrations'` (or wherever Drizzle 1.0 keeps it). Record which column holds the migration name (if there is none, use the hash) and which holds the time, and use them in `getDatabaseDiagnostics`.

- [ ] **Step 4: Write the failing tests.** Use a database cloned from the test template (`createTestDatabase` comes in Task 4). Until then, write the tests against `TEST_DATABASE_URL`, migrated in `beforeAll`, and switch to `createTestDatabase` in Task 4.

```ts
// migrate.test.ts
test("runs twice without error", async () => {
  await runMigrations(url);
  await runMigrations(url);
});

// diagnostics.test.ts
test("reports versions and the latest migration", async () => {
  const d = await getDatabaseDiagnostics(db);
  expect(d.postgresVersion).toMatch(/^\d+(\.\d+)?/);
  expect(d.postgisVersion).toMatch(/^3\./);
  expect(d.latestMigration?.name).toContain("worker_heartbeats");
  expect(d.latestMigration?.createdAt).toBeInstanceOf(Date);
});

// heartbeats.test.ts
test("latest is null on an empty table", async () =>
  expect(await getLatestHeartbeat(db)).toBeNull());
test("records and reads back the latest beat", async () => {
  const at = new Date("2027-03-01T19:30:00Z");
  await recordHeartbeat(db, at);
  expect(await getLatestHeartbeat(db)).toEqual(at);
});
test("prunes beats older than 7 days", async () => {
  await recordHeartbeat(db, new Date(Date.now() - 8 * 86_400_000));
  await recordHeartbeat(db);
  const rows = await db.select().from(workerHeartbeats);
  expect(rows).toHaveLength(1);
});
test("notifies listeners with an event matching the contract", async () => {
  // LISTEN on a separate pg.Client, record a beat, wait for the notification
  expect(workerHeartbeatEventSchema.parse(JSON.parse(payload))).toEqual({
    beatAt: at.toISOString(),
  });
});
test("seed runs twice without error", async () => {
  await seed(db);
  await seed(db);
});
```

- [ ] **Step 5: Run them.** `pnpm test packages/db`. Expected: FAIL for the unimplemented functions.

- [ ] **Step 6: Implement** `client.ts`, `heartbeats.ts`, `diagnostics.ts`, `seed.ts` and the CLIs.

- [ ] **Step 7: Run them.** `pnpm test packages/db && pnpm check`. Expected: PASS.

- [ ] **Step 8: Commit.** `git commit -m "Add the db package with the heartbeat table and diagnostics"`

---

### Task 4: Test databases cloned from a template

**Files:**

- Create: `packages/db/src/testing.ts`, `scripts/vitest-global-setup.ts`
- Modify: `vitest.config.ts` (root global setup), `packages/db/package.json` (export `"./testing": "./src/testing.ts"`), Task 3's tests
- Test: `packages/db/src/testing.test.ts`

**Interfaces:**

- Produces (from `@padvinder/db/testing`):
  - `prepareTestTemplate(): Promise<void>`: drops and recreates the database in `TEST_DATABASE_URL`, runs `runMigrations` on it, and closes every connection to it.
  - `type TestDatabase = { url: string; db: Db; pool: pg.Pool; drop(): Promise<void> }`
  - `createTestDatabase(): Promise<TestDatabase>`: `CREATE DATABASE <template>_<8 random lowercase chars> TEMPLATE <template>` over an admin connection to the `postgres` database; `drop()` closes the pool and drops the clone `WITH (FORCE)`.
- The root Vitest global setup calls `prepareTestTemplate()` exactly once per run, before any project starts. If Vitest 5 runs global setups per project, move it so it still runs once. The requirement is once per run.

- [ ] **Step 1: Write the failing tests.**

```ts
test("a clone has the migrated schema", async () => {
  const t = await createTestDatabase();
  expect(await getLatestHeartbeat(t.db)).toBeNull();
  await t.drop();
});
test("clones are isolated from each other", async () => {
  const [a, b] = await Promise.all([createTestDatabase(), createTestDatabase()]);
  await recordHeartbeat(a.db);
  expect(await getLatestHeartbeat(b.db)).toBeNull();
  await Promise.all([a.drop(), b.drop()]);
});
test("eight concurrent clones succeed (no 'being accessed by other users')", async () => {
  const dbs = await Promise.all(Array.from({ length: 8 }, () => createTestDatabase()));
  await Promise.all(dbs.map((d) => d.drop()));
});
test("drop removes the clone", async () => {
  const t = await createTestDatabase();
  await t.drop();
  // query pg_database via an admin connection: no row for t.url's database
});
```

- [ ] **Step 2: Run them.** `pnpm test packages/db/src/testing.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `testing.ts` and the global setup.** Switch Task 3's tests to one `createTestDatabase()` per file (`beforeAll`/`afterAll`).

- [ ] **Step 4: Run them.** `pnpm check`. Expected: PASS. Then `psql ... -c "select count(*) from pg_database where datname like 'padvinder_<workspace>_test_%'"`. Expected: `0` (no leftover clones).

- [ ] **Step 5: Commit.** `git commit -m "Clone a fresh test database per test file from a template"`

---

### Task 5: Worker with the heartbeat job

**Files:**

- Create: `apps/worker/package.json`, `tsconfig.json`, `vitest.config.ts`, `tsdown.config.ts`, `src/env.ts`, `src/jobs/heartbeat.ts`, `src/main.ts`
- Test: `apps/worker/src/jobs/heartbeat.test.ts`, `apps/worker/src/env.test.ts`

**Interfaces:**

- Consumes: `createDb`, `recordHeartbeat`, `Db` (Task 3); `createTestDatabase` (Task 4).
- Produces:
  - `type WorkerEnv = { DATABASE_URL: string; LOG_LEVEL: string }`, `loadWorkerEnv(source: Record<string, string | undefined>): WorkerEnv` (throws an error naming each missing or invalid variable).
  - `HEARTBEAT_QUEUE = "heartbeat"`, `registerHeartbeatJob(boss: PgBoss, db: Db): Promise<void>`: creates the queue, schedules cron `* * * * *` with time zone `Europe/Amsterdam`, and works it with `recordHeartbeat(db)`.
  - `main.ts`: loads env, starts pg-boss on `DATABASE_URL`, records one heartbeat immediately, registers the job, and on `SIGTERM`/`SIGINT` stops pg-boss gracefully and ends the pool.
- Scripts: `dev` (`tsx watch` with the env-file flags), `build` (tsdown → `dist/main.js`), `start` (`node dist/main.js`), `typecheck`.

- [ ] **Step 1: Write the failing tests.**

```ts
// env.test.ts
test("names the missing variable", () => expect(() => loadWorkerEnv({})).toThrow(/DATABASE_URL/));

// heartbeat.test.ts (test database, pg-boss started on its URL)
test("a sent heartbeat job records a beat", async () => {
  await registerHeartbeatJob(boss, t.db);
  await boss.send(HEARTBEAT_QUEUE);
  await expect.poll(() => getLatestHeartbeat(t.db), { timeout: 10_000 }).not.toBeNull();
});
test("the cron schedule is registered in Europe/Amsterdam", async () => {
  await registerHeartbeatJob(boss, t.db);
  const schedules = await boss.getSchedules();
  expect(schedules).toContainEqual(
    expect.objectContaining({
      name: HEARTBEAT_QUEUE,
      cron: "* * * * *",
      timezone: "Europe/Amsterdam",
    }),
  );
});
```

- [ ] **Step 2: Run them.** `pnpm test apps/worker`. Expected: FAIL.

- [ ] **Step 3: Implement** `env.ts`, `jobs/heartbeat.ts`, `main.ts`, and the tsdown config.

- [ ] **Step 4: Run them, then try it by hand.** `pnpm test apps/worker && pnpm check`. Expected: PASS. Then `pnpm --filter @padvinder/worker dev`, wait 70 seconds, and `psql ... -c "select count(*) from worker_heartbeats"`. Expected: at least `2`. Stop with Ctrl-C. Expected: a clean exit, no stack trace.

- [ ] **Step 5: Verify the build.** `pnpm --filter @padvinder/worker build && node --env-file=.env apps/worker/dist/main.js`. Expected: it starts and records a beat. Stop it.

- [ ] **Step 6: Commit.** `git commit -m "Add the worker with a pg-boss heartbeat job"`

---

### Task 6: API: app factory, health, version, Origin check, OpenAPI

**Files:**

- Create: `apps/api/package.json`, `tsconfig.json`, `vitest.config.ts`, `tsdown.config.ts`, `src/env.ts`, `src/app.ts`, `src/main.ts`, `src/plugins/origin-check.ts`, `src/routes/health.ts`, `src/routes/version.ts`, `src/realtime/notification-hub.ts` (interface only in this task)
- Test: `apps/api/src/routes/health.test.ts`, `src/routes/version.test.ts`, `src/plugins/origin-check.test.ts`, `src/env.test.ts`, `src/openapi.test.ts`

**Interfaces:**

- Consumes: contracts (Task 1); `createDb`, `getDatabaseDiagnostics`, `getLatestHeartbeat`, `recordHeartbeat` (Task 3); `createTestDatabase` (Task 4).
- Produces:
  - `type ApiEnv` and `loadApiEnv(source): ApiEnv` covering `DATABASE_URL`, `API_PORT`, `API_HOST`, `ALLOWED_ORIGINS` (parsed into `string[]`, at least one), `GIT_COMMIT`, `MIN_APP_VERSION` (CalVer), `MOBILE_DIST_DIR?`, `PORTAL_DIST_DIR?`, `LOG_LEVEL`.
  - `interface NotificationHub { subscribe(channel: string, listener: (payload: string) => void): () => void; listenerCount(channel: string): number; close(): Promise<void> }`
  - `createNoopNotificationHub(): NotificationHub` (subscribes nothing; for tests, OpenAPI generation, and `main.ts` until Task 7)
  - `type AppDeps = { env: ApiEnv; db: Db; notifications: NotificationHub; logger?: boolean }`, `buildApp(deps: AppDeps): Promise<FastifyInstance>`: Zod type provider, `@fastify/swagger` with `jsonSchemaTransform`, the Origin check, and all routes under prefix `/api`. No CORS plugin.
  - `GET /api/health` (operationId `getHealth`, response `healthResponseSchema` for both 200 and 503). It catches database errors and reports `reachable: false` with null versions; the status comes from `deriveOverallStatus`.
  - `GET /api/version` (operationId `getVersion`, response `versionResponseSchema`).
  - Origin check (`onRequest`): for methods other than GET, HEAD and OPTIONS, reply 403 when an `Origin` header is present and not in `ALLOWED_ORIGINS`. A request without `Origin` (curl, server-to-server) passes.
  - `main.ts`: loads env, creates the db, uses `createNoopNotificationHub()` (replaced by the real hub in Task 7), builds the app, and listens on `API_HOST`/`API_PORT`. It closes everything on `SIGTERM`/`SIGINT`.

- [ ] **Step 1: Write the failing tests** (use `app.inject`; a test database per file).

```ts
// health.test.ts
test("200 ok with a fresh heartbeat", async () => {
  await recordHeartbeat(t.db);
  const res = await app.inject("/api/health");
  expect(res.statusCode).toBe(200);
  const body = healthResponseSchema.parse(res.json());
  expect(body).toMatchObject({ status: "ok", commit: "test-commit", database: { reachable: true } });
  expect(body.database.postgisVersion).toMatch(/^3\./);
  expect(body.database.latestMigration?.name).toContain("worker_heartbeats");
});
test("503 degraded without a heartbeat", async () => {
  const res = await app.inject("/api/health");
  expect(res.statusCode).toBe(503);
  expect(res.json()).toMatchObject({ status: "degraded", worker: { lastHeartbeatAt: null } });
});
test("503 with reachable:false when the database is down, within 5 s", async () => {
  const down = createDb("postgres://padvinder:padvinder@127.0.0.1:1/none");
  const app2 = await buildApp({ env, db: down.db, notifications: createNoopNotificationHub() });
  const started = Date.now();
  const res = await app2.inject("/api/health");
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(res.statusCode).toBe(503);
  expect(res.json().database).toEqual({ reachable: false, postgresVersion: null, postgisVersion: null, latestMigration: null });
});

// version.test.ts
test("reports the minimum app version and commit", async () =>
  expect((await app.inject("/api/version")).json()).toEqual({ minimumAppVersion: "2027.0.0", commit: "test-commit" }));

// origin-check.test.ts (registers a test-only POST /api/test-echo)
test("403 for a foreign Origin", ...);           // Origin: https://evil.example → 403
test("passes for an allowed Origin", ...);       // Origin: http://localhost:4101 → 200
test("passes without an Origin header", ...);    // → 200
test("GET is never blocked", ...);               // GET /api/health with a foreign Origin → not 403
test("no CORS headers for other sites", ...);    // OPTIONS with a foreign Origin → no access-control-allow-origin header

// env.test.ts
test("rejects an invalid MIN_APP_VERSION", () => expect(() => loadApiEnv({ ...valid, MIN_APP_VERSION: "1.0" })).toThrow(/MIN_APP_VERSION/));
test("defaults API_HOST to ::", () => expect(loadApiEnv(valid).API_HOST).toBe("::"));

// openapi.test.ts
test("documents getHealth and getVersion", async () => {
  const doc = app.swagger();
  expect(doc.paths["/api/health"].get.operationId).toBe("getHealth");
  expect(doc.paths["/api/version"].get.operationId).toBe("getVersion");
});
```

- [ ] **Step 2: Run them.** `pnpm test apps/api`. Expected: FAIL.

- [ ] **Step 3: Implement** the env, the factory, the plugin, the routes and `main.ts`.

- [ ] **Step 4: Run them.** `pnpm test apps/api && pnpm check`. Expected: PASS.

- [ ] **Step 5: Try it with curl.** Start `pnpm --filter @padvinder/api dev` and the worker. Run `curl -s localhost:$API_PORT/api/health | jq`. Expected: `"status": "ok"`. Run `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' localhost:$API_PORT/api/health`. Expected: `403`.

- [ ] **Step 6: Commit.** `git commit -m "Add the API with health, version and the Origin check"`

---

### Task 7: API: notification hub and SSE endpoint

**Files:**

- Create: `apps/api/src/realtime/notification-hub.ts` (implementation), `apps/api/src/routes/events.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/main.ts`
- Test: `apps/api/src/realtime/notification-hub.test.ts`, `apps/api/src/routes/events.test.ts`

**Interfaces:**

- Consumes: `NotificationHub` (Task 6), `WORKER_HEARTBEAT_CHANNEL`, `recordHeartbeat` (Task 3), `SSE_EVENT_WORKER_HEARTBEAT`, `workerHeartbeatEventSchema` (Task 1).
- Produces:
  - `startNotificationHub(options: { databaseUrl: string; channels: string[]; logger: FastifyBaseLogger; reconnectDelayMs?: number }): Promise<NotificationHub>`: one dedicated `pg.Client` with `application_name` `padvinder-notifications`, `LISTEN` on each channel, fan-out to subscribers. On error or end, it reconnects after `reconnectDelayMs` (default 5 000), retrying until `close()`.
  - `GET /api/events` (hidden from OpenAPI): `text/event-stream`, headers `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. It hijacks the reply and sends `event: worker-heartbeat` plus `data: <JSON>` per notification, after validating the payload with `workerHeartbeatEventSchema`; an invalid payload is logged and dropped. It sends a `: keepalive` comment every `SSE_KEEPALIVE_MS = 25_000` and unsubscribes when the client disconnects.

- [ ] **Step 1: Write the failing tests** (`app.listen({ port: 0, host: "127.0.0.1" })` with a real hub on the test database; read the stream with `fetch`).

```ts
// events.test.ts
test("forwards a heartbeat as an SSE event", async () => {
  const stream = await openEvents(baseUrl);
  const at = await recordHeartbeat(t.db);
  await expect(stream.nextEvent()).resolves.toEqual({ event: "worker-heartbeat", data: { beatAt: at.toISOString() } });
});
test("sends no-buffering headers", ...);          // content-type text/event-stream, x-accel-buffering: no
test("unsubscribes when the client disconnects", async () => {
  const stream = await openEvents(baseUrl);
  stream.close();
  await expect.poll(() => hub.listenerCount(WORKER_HEARTBEAT_CHANNEL)).toBe(0);
});

// notification-hub.test.ts
test("reconnects after the listener is terminated", async () => {
  const hub = await startNotificationHub({ databaseUrl: t.url, channels: [WORKER_HEARTBEAT_CHANNEL], logger, reconnectDelayMs: 100 });
  const received: string[] = [];
  hub.subscribe(WORKER_HEARTBEAT_CHANNEL, (p) => received.push(p));
  await t.pool.query("select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'padvinder-notifications'");
  await expect.poll(async () => { await recordHeartbeat(t.db); return received.length; }, { timeout: 10_000, interval: 300 }).toBeGreaterThan(0);
  await hub.close();
});
test("drops payloads that do not match the contract", ...); // pg_notify with '{"nope":1}' → no SSE event, no crash
```

- [ ] **Step 2: Run them.** `pnpm test apps/api`. Expected: FAIL.

- [ ] **Step 3: Implement** the hub and the route. Wire the hub into `main.ts` with `channels: [WORKER_HEARTBEAT_CHANNEL]`.

- [ ] **Step 4: Run them.** `pnpm test apps/api && pnpm check`. Expected: PASS.

- [ ] **Step 5: Try it with curl.** With the API and worker running, run `curl -N localhost:$API_PORT/api/events`. Expected: an `event: worker-heartbeat` line within about 60 seconds, and `: keepalive` lines every 25 seconds.

- [ ] **Step 6: Commit.** `git commit -m "Forward worker heartbeats over SSE"`

---

### Task 8: API serves the mobile and portal builds

**Files:**

- Create: `apps/api/src/plugins/static-apps.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/plugins/static-apps.test.ts` (temporary dirs with fake `index.html`, `assets/app.js`, `sw.js`)

**Interfaces:**

- Consumes: `ApiEnv.MOBILE_DIST_DIR`, `ApiEnv.PORTAL_DIST_DIR` (Task 6). Registered only for the dirs that are set.
- Produces: the mobile build under `/app/`, the portal build under `/`, and `/api/*` untouched. `GET /app` redirects to `/app/`. Unknown paths without a file extension that accept HTML fall back to that app's `index.html`. Unknown paths with an extension, and unknown `/api/*` paths, return 404 (the API's as JSON). `sw.js`, `index.html` and `manifest.webmanifest` get `Cache-Control: no-cache`; files under `assets/` get `public, max-age=31536000, immutable`.

- [ ] **Step 1: Write the failing tests.**

```ts
test.each([
  ["/app/", "mobile-index"], ["/app/more", "mobile-index"], ["/", "portal-index"], ["/system", "portal-index"],
])("GET %s serves %s", async (url, marker) => expect((await app.inject({ url, headers: { accept: "text/html" } })).body).toContain(marker));
test("GET /app redirects to /app/", ...);                    // 301/302, location /app/
test("missing asset under /app/ is 404, not HTML", ...);     // /app/assets/missing.js → 404, content-type not text/html
test("unknown /api path is a JSON 404", ...);                // /api/nope → 404, application/json
test("sw.js is not cached", ...);                            // cache-control no-cache
test("hashed assets are cached for a year", ...);            // /app/assets/app.js → immutable
test("without dist dirs, / is a 404", ...);                  // dev and test default
```

- [ ] **Step 2: Run them.** `pnpm test apps/api/src/plugins/static-apps.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the plugin with `@fastify/static` (two registrations, `decorateReply: false` on the second) and a not-found handler that applies the fallback rules.

- [ ] **Step 4: Run them.** `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Serve the mobile and portal builds from the API"`

---

### Task 9: `packages/api-client`: OpenAPI, generated client, live updates

**Files:**

- Create: `apps/api/src/openapi/write-openapi.ts`, `packages/api-client/package.json`, `tsconfig.json`, `vitest.config.ts`, `openapi-ts.config.ts`, `src/index.ts`, `src/query-client.ts`, `src/server-events.ts`, `src/health-live-updates.ts`
- Create (generated): `packages/api-client/openapi.json`, `packages/api-client/src/generated/**`
- Modify: root `package.json` (`api:generate`)
- Test: `packages/api-client/src/health-live-updates.test.ts`, `src/server-events.test.ts`

**Interfaces:**

- Consumes: `buildApp` (Task 6); contracts (Task 1).
- Produces:
  - `write-openapi.ts`: builds the app with a pool that is never connected and `createNoopNotificationHub()`, then writes `app.swagger()` as JSON (2-space indent, trailing newline) to `packages/api-client/openapi.json`.
  - `pnpm api:generate`: runs `write-openapi.ts`, then `openapi-ts` (fetch client and TanStack Query plugin, output `src/generated`). Running it twice in a row produces no diff.
  - From `@padvinder/api-client`: everything the generated code exports, including `getHealthOptions()`, `getHealthQueryKey()` and `getVersionOptions()` (confirm the names in the generated output). Plus:
  - `createQueryClient(): QueryClient` (the generated client's `baseUrl` is `""`, so the same origin is used).
  - `type ServerEventHandlers = { onWorkerHeartbeat?: (event: WorkerHeartbeatEvent) => void }`, `subscribeToServerEvents(handlers: ServerEventHandlers, options?: { url?: string; EventSourceImpl?: typeof EventSource }): () => void`. Default URL `/api/events`. It validates each payload with the contract schema and ignores invalid ones.
  - `applyWorkerHeartbeat(health: HealthResponse, event: WorkerHeartbeatEvent, now: Date): HealthResponse`. It ignores an event older than the cached `lastHeartbeatAt`, and recomputes `status` with `deriveOverallStatus` using the cached `database.reachable`.
  - `useHealthLiveUpdates(): void`: a React hook that subscribes on mount, unsubscribes on unmount, and applies events to the cache under `getHealthQueryKey()`. When nothing is cached, it does nothing.

- [ ] **Step 1: Write the failing tests.**

```ts
// health-live-updates.test.ts
const event = { beatAt: "2027-03-01T19:31:00.000Z" };
const now = new Date("2027-03-01T19:31:05Z");
test("a new heartbeat makes a stale but reachable system ok", () =>
  expect(applyWorkerHeartbeat(workerStaleFixture, event, now)).toMatchObject({ status: "ok", worker: { lastHeartbeatAt: event.beatAt } }));
test("stays degraded when the database is unreachable", () =>
  expect(applyWorkerHeartbeat(databaseUnreachableFixture, event, now).status).toBe("degraded"));
test("ignores an older event (out of order)", () =>
  expect(applyWorkerHeartbeat(healthyFixture, { beatAt: "2027-03-01T19:00:00.000Z" }, now)).toEqual(healthyFixture));

// server-events.test.ts (fake EventSource)
test("calls onWorkerHeartbeat with the parsed event", ...);
test("ignores malformed JSON and schema mismatches without throwing", ...);
test("the returned function closes the EventSource", ...);
```

- [ ] **Step 2: Run them.** `pnpm test packages/api-client`. Expected: FAIL.

- [ ] **Step 3: Implement** `write-openapi.ts` and the config. Run `pnpm api:generate`, then implement the three source files.

- [ ] **Step 4: Run them and check the generated files are stable.** `pnpm test packages/api-client && pnpm check && pnpm api:generate && git status --porcelain packages/api-client`. Expected: PASS; no changes after the second generation.

- [ ] **Step 5: Commit.** `git commit -m "Generate the API client and add live health updates"`

---

### Task 10: `packages/ui`: Tailwind, shadcn/ui, `HealthStatus`, Storybook

**Files:**

- Create: `packages/ui/package.json`, `tsconfig.json`, `vitest.config.ts`, `components.json`, `src/styles.css`, `src/index.ts`, `src/lib/utils.ts`, `src/lib/format.ts`, `src/components/ui/*` (shadcn `card`, `badge`, `button`), `src/components/health-status.tsx`, `src/components/health-status.stories.tsx`, `.storybook/main.ts`, `.storybook/preview.ts`
- Modify: root `package.json` (`storybook`, `storybook:build`)
- Test: `packages/ui/src/components/health-status.test.tsx`, `src/lib/format.test.ts`

**Interfaces:**

- Consumes: `HealthResponse` and the fixtures (Task 1).
- Produces (from `@padvinder/ui`): `HealthStatus`, `type HealthStatusProps = { health?: HealthResponse; loadFailed?: boolean }`, `Button`, `Card`, `Badge`, `cn`, `formatDateTime(value: Date | string): string` (`nl-NL`, `Europe/Amsterdam`, for example `1-3-2027 20:30:00`). From `@padvinder/ui/styles.css`: Tailwind with the theme tokens and an `@source` covering the ui components. The brand color is a placeholder red, with a comment that the visual identity is not set yet.
- Dutch copy for `HealthStatus` (exact):
  - Heading `Systeemstatus`
  - Badge `Alles werkt` / `Er is een storing`
  - Row labels `Database`, `PostgreSQL`, `PostGIS`, `Laatste migratie`, `Achtergrondtaken`, `Versie`
  - Database value `Verbonden` / `Niet bereikbaar`
  - PostGIS missing `Niet geïnstalleerd`
  - Heartbeat `Laatste hartslag: {formatDateTime}` / `Nog geen hartslag`
  - Commit shown as its first 7 characters
  - Loading `Systeemstatus laden…`
  - Load failed `De server is niet bereikbaar. Probeer het straks opnieuw.`
- Storybook stories: `Healthy`, `WorkerStale`, `DatabaseUnreachable`, `Loading`, `LoadFailed`, on Storybook port `STORYBOOK_PORT`.

- [ ] **Step 1: Write the failing tests** (jsdom and Testing Library).

```tsx
test("healthy", () => {
  render(<HealthStatus health={healthyFixture} />);
  expect(screen.getByText("Alles werkt")).toBeVisible();
  expect(screen.getByText("Verbonden")).toBeVisible();
  expect(screen.getByText("0123456")).toBeVisible();
});
test("degraded worker", () => {
  render(<HealthStatus health={workerStaleFixture} />);
  expect(screen.getByText("Er is een storing")).toBeVisible();
});
test("database unreachable", () => {
  render(<HealthStatus health={databaseUnreachableFixture} />);
  expect(screen.getByText("Niet bereikbaar")).toBeVisible();
});
test("no heartbeat yet", () => {
  render(<HealthStatus health={{ ...healthyFixture, worker: { lastHeartbeatAt: null } }} />);
  expect(screen.getByText("Nog geen hartslag")).toBeVisible();
});
test("loading", () => {
  render(<HealthStatus />);
  expect(screen.getByText("Systeemstatus laden…")).toBeVisible();
});
test("load failed", () => {
  render(<HealthStatus loadFailed />);
  expect(screen.getByText(/De server is niet bereikbaar/)).toBeVisible();
});
// format.test.ts
test("shows Amsterdam time (CET in March)", () =>
  expect(formatDateTime("2027-03-01T19:30:00.000Z")).toContain("20:30"));
test("shows Amsterdam time (CEST in April)", () =>
  expect(formatDateTime("2027-04-01T19:30:00.000Z")).toContain("21:30"));
```

- [ ] **Step 2: Run them.** `pnpm test packages/ui`. Expected: FAIL.

- [ ] **Step 3: Set up Tailwind and shadcn/ui** in `packages/ui` (shadcn CLI with `components.json` for this package), then add `card`, `badge`, `button`. Implement `formatDateTime` and `HealthStatus`, and write the stories using the fixtures.

- [ ] **Step 4: Run them.** `pnpm test packages/ui && pnpm check && pnpm storybook:build`. Expected: PASS, and Storybook builds. Start `pnpm storybook` and look at all five stories; save a screenshot of `Healthy` to `.context/healthy-story.png`.

- [ ] **Step 5: Commit.** `git commit -m "Add the ui package with HealthStatus and Storybook"`

---

### Task 11: `apps/mobile`: PWA under `/app/`

**Files:**

- Create: `apps/mobile/package.json`, `tsconfig.json`, `vitest.config.ts`, `vite.config.ts`, `index.html`, `public/icon.svg` (placeholder), `pwa-assets.config.ts`, `src/main.tsx`, `src/app.tsx`, `src/router.tsx`, `src/app-version.ts`, `src/components/tab-bar.tsx`, `src/components/version-gate.tsx`, `src/components/update-prompt.tsx`, `src/screens/tonight-screen.tsx`, `src/screens/map-screen.tsx`, `src/screens/results-screen.tsx`, `src/screens/more-screen.tsx`, `src/index.css`
- Test: `apps/mobile/src/components/tab-bar.test.tsx`, `src/components/version-gate.test.tsx`, `src/screens/more-screen.test.tsx`

**Interfaces:**

- Consumes: `@padvinder/api-client` (`createQueryClient`, `getHealthOptions`, `getVersionOptions`, `useHealthLiveUpdates`), `@padvinder/ui` (`HealthStatus`, `Button`, styles), `compareCalVer` (Task 1).
- Produces:
  - Vite: `base: "/app/"`, `envDir` at the repo root, dev server on `MOBILE_PORT` with `strictPort`, a proxy for `/api` to `http://localhost:${API_PORT}`, and HTTPS through `vite-plugin-mkcert` only when `DEV_HTTPS=1` (then also `server.host: true`). `define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? "2027.0.0") }`.
  - PWA (`vite-plugin-pwa`): `registerType: "prompt"`; manifest `name` and `short_name` `PadVinder`, `lang: "nl"`, `start_url: "/app/"`, `scope: "/app/"`, `display: "standalone"`, and icons generated from `public/icon.svg`. Workbox `navigateFallback: "/app/index.html"`, with no runtime caching of `/api`.
  - React Router with `basename: "/app"`. Routes: `/` Vanavond (`TonightScreen`), `/map` Kaart, `/results` Resultaten, `/more` Meer. `TabBar` shows those four Dutch labels and links to those paths. The tonight, map and results screens show their title and `Komt binnenkort.`
  - `APP_VERSION: string` (from `__APP_VERSION__`). `VersionGate({ children })`: when `/api/version` reports `minimumAppVersion` above `APP_VERSION`, it renders the update screen instead of children. When the request fails, it renders children.
  - Update screen copy (exact): heading `Werk de app bij`, text `Er is een nieuwe versie van PadVinder. Tik op de knop om bij te werken.`, button `Werk de app bij` (updates the service worker, then reloads).
  - `UpdatePrompt`: when the service worker has a waiting version, shows `Er is een nieuwe versie.` with the button `Werk de app bij`.
  - `MoreScreen`: heading `Meer`; renders `HealthStatus` from `useQuery(getHealthOptions())` (`loadFailed` on error) and calls `useHealthLiveUpdates()`.
- Scripts: `dev`, `build`, `preview`, `typecheck`.

- [ ] **Step 1: Write the failing tests** (jsdom, a `MemoryRouter`, fetch mocked with fixtures).

```tsx
test("tab bar has the four Dutch tabs with English paths", () => {
  // Vanavond → /, Kaart → /map, Resultaten → /results, Meer → /more
});
test("version gate blocks an outdated app", async () => {
  mockFetch("/api/version", { minimumAppVersion: "2099.0.0", commit: "x" });
  render(<VersionGate><p>inhoud</p></VersionGate>);
  expect(await screen.findByRole("heading", { name: "Werk de app bij" })).toBeVisible();
  expect(screen.queryByText("inhoud")).toBeNull();
});
test("version gate lets a current app through", ...);           // minimumAppVersion "2027.0.0" → children
test("version gate lets the app through when the API fails", ...); // fetch rejects → children
test("more screen shows the system status", async () => {
  mockFetch("/api/health", healthyFixture);
  render(<MoreScreen />);
  expect(await screen.findByText("Alles werkt")).toBeVisible();
});
test("more screen shows the load error", ...);                  // 500 or network error → /De server is niet bereikbaar/
```

- [ ] **Step 2: Run them.** `pnpm test apps/mobile`. Expected: FAIL.

- [ ] **Step 3: Implement** the Vite config, the PWA config, the router, the screens and the components.

- [ ] **Step 4: Run them, and inspect the build.** `pnpm test apps/mobile && pnpm check && pnpm --filter @padvinder/mobile build`. Then `jq '{start_url, scope, display, lang}' apps/mobile/dist/manifest.webmanifest`. Expected: `"/app/"`, `"/app/"`, `"standalone"`, `"nl"`. And `grep -c '/app/index.html' apps/mobile/dist/sw.js`. Expected: at least `1`.

- [ ] **Step 5: Commit.** `git commit -m "Add the mobile PWA with the system status on the Meer tab"`

---

### Task 12: `apps/portal`

**Files:**

- Create: `apps/portal/package.json`, `tsconfig.json`, `vitest.config.ts`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/router.tsx`, `src/pages/home-page.tsx`, `src/pages/system-page.tsx`, `src/index.css`
- Test: `apps/portal/src/pages/system-page.test.tsx`, `apps/portal/src/router.test.ts`

**Interfaces:**

- Consumes: the same as Task 11, minus the PWA and the version gate.
- Produces: Vite with `base: "/"`, dev server on `PORTAL_PORT` (`strictPort`), the `/api` proxy, and optional HTTPS as in Task 11. Routes: `/` `HomePage` (heading `PadVinder`, a link `Systeemstatus` to `/system`) and `/system` `SystemPage` (heading `Systeemstatus`, `HealthStatus` with live updates). No route may start with `/app` or `/api`.

- [ ] **Step 1: Write the failing tests.**

```tsx
test("system page shows the status", async () => {
  mockFetch("/api/health", workerStaleFixture);
  render(<SystemPage />);
  expect(await screen.findByText("Er is een storing")).toBeVisible();
});
test("no portal route starts with /app or /api", () => {
  for (const path of collectPaths(routes)) expect(path).not.toMatch(/^\/(app|api)(\/|$)/);
});
```

- [ ] **Step 2: Run them.** `pnpm test apps/portal`. Expected: FAIL.

- [ ] **Step 3: Implement** the Vite config, the router and the pages. Export the route objects from `router.tsx` so the test can walk them.

- [ ] **Step 4: Run them.** `pnpm test apps/portal && pnpm check && pnpm --filter @padvinder/portal build`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add the portal with the system status page"`

---

### Task 13: `pnpm dev`, HTTPS option, Playwright end-to-end test

**Files:**

- Create: `playwright.config.ts`, `e2e/mobile-system-status.spec.ts`
- Modify: root `package.json` (`dev`, `dev:https`, `build`, `test:e2e`), `scripts/setup-workspace.sh` (no longer skipping missing steps)

**Interfaces:**

- Consumes: every app's `dev` and `build` scripts; ports and env from Task 2.
- Produces:
  - `pnpm dev`: `pnpm --parallel --filter "./apps/*" dev`, so all four apps run in one process group and Ctrl-C stops them all.
  - `pnpm dev:https`: the same with `DEV_HTTPS=1`.
  - `pnpm build`: `pnpm -r --filter "./apps/*" build`.
  - `pnpm test:e2e`: Playwright with `webServer` running `pnpm dev`, waiting for `http://localhost:${MOBILE_PORT}/app/`, and `reuseExistingServer: true`. Chromium with a phone viewport (`devices["Pixel 7"]`).

- [ ] **Step 1: Write the failing test.**

```ts
test("the Meer tab shows a working system", async ({ page }) => {
  await page.goto("/app/");
  await page.getByRole("link", { name: "Meer" }).click();
  await expect(page).toHaveURL(/\/app\/more$/);
  await expect(page.getByRole("heading", { name: "Systeemstatus" })).toBeVisible();
  await expect(page.getByText("Alles werkt")).toBeVisible({ timeout: 15_000 });
});
test("a deep link to /app/more works on reload", async ({ page }) => {
  await page.goto("/app/more");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Meer" })).toBeVisible();
});
```

- [ ] **Step 2: Run it.** `pnpm test:e2e`. Expected: FAIL until the root scripts and the config exist; then PASS.

- [ ] **Step 3: Check the whole local loop by hand.**
  - Run `pnpm dev`.
  - Open `http://localhost:$PORTAL_PORT/system` and `http://localhost:$MOBILE_PORT/app/more`. Expected: both show `Alles werkt`, and the heartbeat time moves forward within about 60 seconds without a reload.
  - Edit the text of `HealthStatus`. Expected: both apps hot-reload.
  - Edit an API route. Expected: the API restarts.
  - Save screenshots to `.context/mobile-more.png` and `.context/portal-system.png`.
  - Then run `pnpm dev:https` once and check that `https://<LAN IP>:$MOBILE_PORT/app/` loads. Document the iPhone certificate step in Task 14.

- [ ] **Step 4: Run the full check.** `pnpm check && pnpm build && pnpm test:e2e`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Run all apps with pnpm dev and add the first end-to-end test"`

---

### Task 14: Documentation and Conductor

**Files:**

- Modify: `AGENTS.md`, `docs/superpowers/specs/2026-11-21-monorepo-setup-design.md` (only if something turned out differently, recorded as a dated note)

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: Update `AGENTS.md`.**
  - **Current state:** what now exists.
  - **Repository layout:** the real one. Remove `packages/map`; the map will live in `packages/ui`.
  - **Development workflow:** the real commands. Setup script, `pnpm dev`, `pnpm dev:https` with the iPhone certificate steps, `pnpm check` as the command every agent runs before finishing, `pnpm test:e2e`, the db commands, `pnpm api:generate`, and teardown.
  - **Tech stack:** close the open library points with the choices and pinned versions from the spec.
  - **New short sections:**
    - Per-workspace databases and ports.
    - Where generated files live and how to regenerate them.
    - The health endpoint as the reference example of every layer.
    - A placeholder note: "The idempotent-write pattern (client-generated UUIDv7; same ID twice gives one record) arrives in slice 1 with authentication; until then, no write endpoints."
  - Keep the rest of the file intact.

- [ ] **Step 2: Configure Conductor.** Ask the maintainer before changing repository settings. With approval, use `GetRepositorySettings`, then `UpdateRepositorySettings`:
  - setup script `./scripts/setup-workspace.sh`
  - archive script `./scripts/teardown-workspace.sh`
  - run action `pnpm dev`
  - run mode `concurrent` (ports and databases are per workspace)

- [ ] **Step 3: Verify from a clean workspace.** In a fresh `git worktree` (or a new Conductor workspace), run only `./scripts/setup-workspace.sh && pnpm check && pnpm test:e2e`. Expected: PASS with no other manual steps. Tear it down afterwards.

- [ ] **Step 4: Commit.** `git commit -m "Document the real development setup in AGENTS.md"`
