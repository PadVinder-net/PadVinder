# Sentry on the Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Errors and traces from the API and the worker reach Sentry (EU region) with the release, the environment and the account ID, and nothing personal; source maps of the server bundles are uploaded on deploy; provisioning writes the new settings (pull request 2 of the logging and monitoring design).

**Architecture:** A new package `packages/monitoring` owns `@sentry/node`: reading the settings, `Sentry.init` with every data-collection category off, the scrubbing hooks, a test transport, and small helpers (`setMonitoringUser`, `withSpan`, `flushMonitoring`). Each app's `main.ts` initializes it **before anything imports `pg`** and loads the rest of the program by dynamic import, because `@sentry/node` 11.18's `Sentry.init` registers Node's module hooks (`Module.registerHooks`, stable from Node 24.13; the release runs 24.22) that instrument `pg` only when `pg` is loaded afterwards, and a bundle hoists every static external import to the top. Errors become issues through Sentry's pino integration (every `error` line), so there is one path for the API's 500s, the worker's failures and crashes.

**Tech Stack:** `@sentry/node` 11.18.0 (exact), pino 10.4, Fastify 5.12, pg-boss 12, tsdown, `getsentry/sentry-cli:3.8.2` (Docker), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-26-logging-and-monitoring-design.md`, sections "Sentry: the organization", "Configuration", "Server", "Source maps", "Rolling out", "Verification on Alwaysdata". Builds on pull request 1 (`packages/logging`, branch `martijnthe/logging`). The browser, the tunnel and problem reports are pull request 3.

## Global Constraints

- `@sentry/node` is pinned exactly at `11.18.0` in `packages/monitoring`, `apps/api` and `apps/worker` (a direct dependency of each bundled app, same version). Its `@sentry/server-runtime-injection` must stay external to the bundle (it is: the bundles keep `node_modules` external).
- `dataCollection` is set explicitly, every category off: `userInfo: false`, `cookies: false`, `httpHeaders: false`, `httpBodies: []`, `urlQueryParams: false`, `databaseQueryData: false`, `queues: false`, `stackFrameVariables: false`, `graphQL: { document: false, variables: false }`, `genAI: { inputs: false, outputs: false }`, `mcp: { inputs: false, outputs: false }`. `frameContextLines` stays at its default (source lines of a public repository).
- The only user field ever sent is `{ id }` (the account's UUID). No name, address, phone number, IP address, cookie, header or body; `serverName` is the service name (`api` or `worker`), not the host.
- Every string of every event, transaction and breadcrumb goes through `scrub` from `@padvinder/logging` before it is sent.
- Tags: `service` (`api` or `worker`); environment from `PADVINDER_ENVIRONMENT` (`production`, `staging`, `development`; default `development`); release is `GIT_COMMIT` (default `dev`).
- Without `SENTRY_DSN` Sentry is off (no `Sentry.init`); everything else works as before. Locally, in tests and in CI it is unset.
- Tracing samples everything except: `/api/health`, `/api/events`, every path outside `/api/`, and the worker's `heartbeat` job.
- One error, one issue: Fastify's own capture is off (`fastifyIntegration({ shouldHandleError: () => false })`), Sentry's `onUncaughtExceptionIntegration` and `onUnhandledRejectionIntegration` are left out (our crash handler logs, and the log line is captured); Sentry's pino integration captures `error` lines only (`error: { levels: ["error"] }`) and sends no Sentry Logs (`log: { levels: [] }`).
- Sentry never blocks or fails a request, a job or a deploy. Shutdown flushes with a 2,000 ms limit.
- The pull request CI uses no secrets. `SENTRY_AUTH_TOKEN` is used only by the Deploy workflow.
- Code and docs in English; no Dutch copy in this pull request.
- `pnpm check` passes; `pnpm api:generate` output committed.

## Review Focus

- **An address inside a span or a breadcrumb** (a Better Auth query on `users.email`, a pino breadcrumb holding a URL with `?email=`): nothing with `@example.test` reaches the fake Sentry server. Pinned in Task 1 (scrub hook tests on a transaction with spans and breadcrumbs) and Task 2 (the spawned login-code request, whose raw envelope bytes are searched).
- **Sentry unreachable** (DSN host refuses connections): a request still answers normally and quickly; shutdown still exits within the time limit. Pinned in Task 2 (spawned API with a DSN to a closed port: `GET /api/version` answers 200 and SIGTERM exits 0 within 5 s).
- **The same error logged twice** (an error thrown into Fastify's handler and logged as "Unexpected error"): exactly one event. Pinned in Task 2.
- **A crash** (uncaught exception) with Sentry on: one event reaches the fake server before the process exits 1. Pinned in Task 1 (spawned fixture).
- **Provisioning without `SENTRY_DSN`** set in the environment: refuses before changing anything, naming the variable; a DSN with characters the env file cannot carry is refused. Pinned in Task 4.

---

### Task 1: The `@padvinder/monitoring` package

**Files:**

- Create: `packages/monitoring/package.json`, `tsconfig.json`, `vitest.config.ts` (project `monitoring`)
- Create: `packages/monitoring/src/index.ts`, `src/settings.ts`, `src/scrub-event.ts`, `src/server.ts`, `src/testing.ts`
- Test: `src/settings.test.ts`, `src/scrub-event.test.ts`, `src/server.test.ts`, `src/instrumentation.test.ts` with fixture `src/instrumentation-fixture.ts`, `src/crash.test.ts` with fixture `src/crash-fixture.ts`, and a fake Sentry ingest helper `src/fake-sentry.ts` (exported from `./testing`)

**Interfaces:**

- Consumes: `scrub`, `createLogger`, `installCrashHandlers`, `Logger` from `@padvinder/logging`.
- Produces (from `@padvinder/monitoring`):
  - `type DeploymentEnvironment = "production" | "staging" | "development"`; `const DEPLOYMENT_ENVIRONMENTS`
  - `readMonitoringSettings(source: Record<string, string | undefined>): MonitoringSettings` where `MonitoringSettings = { dsn: string | undefined; environment: DeploymentEnvironment; release: string }`, from `SENTRY_DSN` (empty counts as unset; when set it must parse as a URL with protocol `https:` or `http:`, else it throws `Error("Invalid monitoring settings: SENTRY_DSN: ...")` naming the variable, never the value), `PADVINDER_ENVIRONMENT` (default `development`; another value throws naming the variable) and `GIT_COMMIT` (default `dev`).
  - `startServerMonitoring(options: { service: "api" | "worker"; settings: MonitoringSettings; transport?: TransportFactory }): boolean` — calls `Sentry.init` with the Global Constraints when `settings.dsn` is set or a `transport` is given (tests); returns whether Sentry is on. Adds `pinoIntegration`, configures `fastifyIntegration`, removes the two global-handler integrations, sets `tracesSampler` per the constraints (sampling context's `name` or `attributes["url.path"]` / `http.target` for requests; the `job.name` attribute for jobs), `beforeSend`/`beforeSendTransaction`/`beforeBreadcrumb` = `scrubEvent`/`scrubEvent`/`scrubBreadcrumb`, `serverName: service`, `initialScope: { tags: { service } }`.
  - `scrubEvent<T>(event: T): T` — returns a copy in which every string (keys untouched) went through `scrub`, cycles become `"[circular]"`, depth beyond 12 becomes `"[depth]"`; it also deletes `request.headers`, `request.cookies`, `request.data`, `request.query_string` and every `user` field except `id`. `scrubBreadcrumb` applies the same to a breadcrumb.
  - `setMonitoringUser(id: string | null): void` — sets `{ id }` on the current isolation scope, or clears it.
  - `withSpan<T>(name: string, op: string, attributes: Record<string, string>, fn: () => Promise<T>): Promise<T>` — `Sentry.startSpan` when Sentry is on, else just `fn()`.
  - `runJobInSpan<T>(job: { name: string; id: string }, fn: () => Promise<T>): Promise<T>` — a new trace (`Sentry.startNewTrace` + `startSpan` with `op: "queue.process"`, name `job.name`, attributes `job.name`, `job.id`) and the scope tags `job.name`, `job.id`.
  - `flushMonitoring(timeoutMs = 2000): Promise<void>` — `Sentry.flush`, never rejects.
  - `closeMonitoring(timeoutMs = 2000): Promise<void>` — `Sentry.close`, never rejects.
- Produces (from `@padvinder/monitoring/testing`):
  - `createTestTransport(): { transport: TransportFactory; envelopes(): unknown[]; events(): Event[]; transactions(): Event[] }` — keeps envelopes in memory (use `createTransport` from `@sentry/core` with a `makeRequest` that stores the parsed envelope and resolves `{ statusCode: 200 }`).
  - `startFakeSentry(): Promise<{ dsn: string; bodies(): string[]; events(): Event[]; transactions(): Event[]; close(): Promise<void> }>` — an HTTP server on 127.0.0.1 accepting `POST /api/<project>/envelope/`, answering 200, keeping the raw decoded bodies (gunzip when `Content-Encoding: gzip`); `dsn` is `http://public@127.0.0.1:<port>/1`.

- [ ] **Step 1: Make the package** like `packages/logging` (`"name": "@padvinder/monitoring"`, exports `.` and `./testing`), dependencies `@sentry/node` `11.18.0` (exact), `@sentry/core` `11.18.0` (exact, for `createTransport` and types), `@padvinder/logging` `workspace:*`; devDependencies `pg` (same range as `apps/api`), `tsx`. Run `pnpm install`.

- [ ] **Step 2: Write the failing unit tests.**

```ts
// settings.test.ts
test("defaults: off, development, dev", () => {
  expect(readMonitoringSettings({})).toEqual({
    dsn: undefined,
    environment: "development",
    release: "dev",
  });
  expect(readMonitoringSettings({ SENTRY_DSN: "" }).dsn).toBeUndefined();
});
test("reads the DSN, environment and commit", () => {
  expect(
    readMonitoringSettings({
      SENTRY_DSN: "https://k@o1.ingest.de.sentry.io/2",
      PADVINDER_ENVIRONMENT: "staging",
      GIT_COMMIT: "abc",
    }),
  ).toEqual({ dsn: "https://k@o1.ingest.de.sentry.io/2", environment: "staging", release: "abc" });
});
test("errors name the variable, never the value", () => {
  expect(() => readMonitoringSettings({ SENTRY_DSN: "not a url secret-value" })).toThrow(
    /SENTRY_DSN/,
  );
  expect(() => readMonitoringSettings({ SENTRY_DSN: "not a url secret-value" })).not.toThrow(
    /secret-value/,
  );
  expect(() => readMonitoringSettings({ PADVINDER_ENVIRONMENT: "prod" })).toThrow(
    /PADVINDER_ENVIRONMENT/,
  );
});

// scrub-event.test.ts
test("scrubs every string, drops request headers, cookies, body, query and user fields but id", () => {
  const event = {
    message: "send to noor@example.test failed",
    user: {
      id: "0190...",
      email: "noor@example.test",
      ip_address: "203.0.113.9",
      username: "Noor",
    },
    request: {
      url: "https://padvinder.test/api/x",
      headers: { cookie: "s=1" },
      cookies: { s: "1" },
      data: '{"email":"a@b.test"}',
      query_string: "email=a@b.test",
    },
    spans: [{ description: "select * from users where email = 'c@d.test'" }],
    breadcrumbs: [{ message: "GET /api/x?email=e@f.test" }],
    extra: { nested: [{ deep: "g@h.test" }] },
  };
  const result = scrubEvent(event);
  expect(JSON.stringify(result)).not.toMatch(/@(example|b|d|f|h)\.test/);
  expect(result.user).toEqual({ id: "0190..." });
  expect(result.request).toEqual({ url: "https://padvinder.test/api/x" });
});
test("survives cycles and depth", () => {
  /* a cyclic object and 20 levels: no throw, "[circular]" and "[depth]" present */
});
```

`server.test.ts` (in-process, with `createTestTransport`; call `closeMonitoring()` in `afterEach`):

```ts
test("an error log line becomes one event with service, environment, release; a warn line none", async () => {
  startServerMonitoring({ service: "api", settings: { dsn: undefined, environment: "staging", release: "abc" }, transport: t.transport });
  const logger = createLogger({ service: "api", level: "info", destination: { write() {} } });
  logger.warn("just a warning");
  logger.error({ err: new Error("boom for noor@example.test") }, "Unexpected error");
  await flushMonitoring();
  expect(t.events()).toHaveLength(1);
  expect(t.events()[0]).toMatchObject({ environment: "staging", release: "abc", tags: { service: "api" }, server_name: "api" });
  expect(JSON.stringify(t.envelopes())).not.toContain("noor@example.test");
});
test("setMonitoringUser sends only the id", async () => { /* captureException inside withIsolationScope after setMonitoringUser("u-1"): user is exactly { id: "u-1" } */ });
test("startServerMonitoring without a DSN or transport returns false and sends nothing", ...);
```

- [ ] **Step 3: Run them to verify they fail.** Run: `pnpm vitest run --project monitoring`. Expected: FAIL (modules missing).

- [ ] **Step 4: Implement `settings.ts`, `scrub-event.ts`, `server.ts` and `testing.ts`.**

- [ ] **Step 5: Run them to verify they pass.** Expected: PASS.

- [ ] **Step 6: Write the failing spawned tests.** Both spawn a fixture with `process.execPath, ["--import", "tsx", fixture]` and env `SENTRY_DSN=<fake dsn>`, `DATABASE_URL` (for the instrumentation fixture: a test database from `createTestDatabase()`).

```ts
// instrumentation.test.ts — the fixture calls startServerMonitoring(readMonitoringSettings(process.env)) FIRST,
// then `await import("pg")`, runs `select $1::text as v` with "noor@example.test" inside withSpan("fixture", "test", {}, ...),
// then flushMonitoring() and exits 0.
test("a query after startServerMonitoring is a db span; no value reaches Sentry", async () => {
  const transaction = fake.transactions().find((tx) => tx.transaction === "fixture")!;
  expect(transaction.spans!.some((span) => span.op === "db")).toBe(true);
  expect(fake.bodies().join("")).not.toContain("noor@example.test");
});

// crash.test.ts — the fixture starts monitoring, creates a logger, installCrashHandlers(logger, { beforeExit: () => flushMonitoring() }),
// then throws new Error("crash for a@b.test") from a timer.
test("a crash sends exactly one event before exiting 1", async () => {
  expect(code).toBe(1);
  expect(fake.events()).toHaveLength(1);
  expect(fake.bodies().join("")).not.toContain("a@b.test");
});
```

- [ ] **Step 7: Run them to verify they fail.** Expected: FAIL.

- [ ] **Step 8: Make them pass** (fixtures written, any fix in `server.ts`).

- [ ] **Step 9: Run the package's tests, `pnpm typecheck`, `pnpm lint`, `pnpm exec oxfmt --check packages/monitoring`.** Expected: all pass.

- [ ] **Step 10: Commit.** `git commit -m "Add the monitoring package: Sentry for the server, scrubbed, off without a DSN"`

### Task 2: The API with Sentry

**Files:**

- Modify: `apps/api/package.json` (`@sentry/node` `11.18.0` dependency; `@padvinder/monitoring` `workspace:*` devDependency), `apps/api/tsdown.config.ts` (`sourcemap: true`)
- Create: `apps/api/src/run.ts` (today's `main.ts` body, as `export async function run(): Promise<void>`)
- Modify: `apps/api/src/main.ts` (only monitoring before the dynamic import), `src/env.ts` (`PADVINDER_ENVIRONMENT`), `src/start-api.ts` (start line gets `environment`; `stop` closes monitoring last), `src/permissions/actor.ts` (`setMonitoringUser`), `src/mail/send-in-background.ts` (`withSpan("mail.send", "mail", { "mail.kind": kind }, ...)`), `src/app.ts` (register the new route), `src/permissions/rules.ts` (`system.triggerTestError`, platform admins only, 403 for others)
- Create: `apps/api/src/routes/system.ts` (`POST /api/system/test-error`), and its contract entries in `packages/contracts` (only `errorResponses`; no body), then `pnpm api:generate`
- Test: `apps/api/src/monitoring.test.ts` (in-process), `apps/api/src/monitoring-spawn.test.ts` (spawned), `apps/api/src/routes/system.test.ts`, `apps/api/src/main.test.ts`, `apps/api/src/env.test.ts`

**Interfaces:**

- Consumes: everything from Task 1.
- Produces: `POST /api/system/test-error` (platform admins: runs `select 1`, then throws `Error("Test error requested by a platform admin")`, so it answers 500 `internal_error` and becomes one Sentry issue; other logged-in users 403 `not_allowed`; no login 401). `ApiEnv.PADVINDER_ENVIRONMENT`.

- [ ] **Step 1: Write the failing tests.**
  - `system.test.ts`: `expectStatuses(cast, { platformAdmin: 500, everyone else: 403, noCookie: 401 }, send)` with the standard cast (AGENTS.md "Permission tests").
  - `monitoring.test.ts` (in-process; `startServerMonitoring` with `createTestTransport` before `createTestApp()`; `closeMonitoring` after): a platform admin's `POST /api/system/test-error` with a cookie and a body `{"email":"noor@example.test"}` gives exactly one event, whose `user` is `{ id: <the platform admin's id> }`, `tags.service` `api`, no `request.headers`, `request.cookies` or `request.data`, and whose raw envelope has no `noor@example.test` and no cookie value. A `GET /api/health` produces no transaction.
  - `monitoring-spawn.test.ts`: spawn `src/main.ts` like `main.test.ts` does, with a fake Sentry DSN; `POST /api/auth/email-otp/send-verification-otp` with `Origin` set to the allowed origin and body `{ "email": "noor@example.test", "type": "sign-in" }`; then SIGTERM. Expect a transaction for that request containing at least one span with `op` `db`, and no `noor@example.test` anywhere in the fake server's raw bodies. A second test: a DSN pointing at a closed port; `GET /api/version` answers 200 within 1 s and SIGTERM exits 0 within 5 s.
  - `main.test.ts`: the "API started" line has `environment: "development"`; an invalid `PADVINDER_ENVIRONMENT` or `SENTRY_DSN` exits 1 with only the message on stderr, like an invalid env.
- [ ] **Step 2: Run them to verify they fail.** Run: `pnpm vitest run --project api src/monitoring.test.ts src/monitoring-spawn.test.ts src/routes/system.test.ts src/main.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `main.ts` holds only: `readMonitoringSettings(process.env)` (on an error: print the message, exit 1, as for the env), `startServerMonitoring({ service: "api", settings })`, then `const { run } = await import("./run"); await run();`. It must not import anything that imports `pg` (no `./env`, no `@padvinder/db`, no `@padvinder/mail`).
  - `run.ts`: today's `main.ts`; `installCrashHandlers(logger, { beforeExit: () => flushMonitoring() })`; shutdown calls `api.stop()` then `closeMonitoring()`.
  - `loadActor` / `requireActor`: after the actor is known, `setMonitoringUser(actor.userId)`; without a session, `setMonitoringUser(null)`.
  - `tsdown.config.ts`: `sourcemap: true`; check `pnpm --filter @padvinder/api build` writes `dist/main.js`, a chunk for `run`, and `.map` files.
- [ ] **Step 4: Run the API's tests.** Run: `pnpm vitest run --project api`. Expected: PASS. Then `pnpm api:generate` and `pnpm check:generated`.
- [ ] **Step 5: Commit.** `git commit -m "Report the API's errors and traces to Sentry, with a test error for platform admins"`

### Task 3: The worker with Sentry

**Files:**

- Modify: `apps/worker/package.json` (as the API), `apps/worker/tsdown.config.ts` (`sourcemap: true`)
- Create: `apps/worker/src/run.ts` (today's `main.ts` body)
- Modify: `apps/worker/src/main.ts`, `src/env.ts` (`PADVINDER_ENVIRONMENT`), `src/jobs/mail.ts` (each job in `runJobInSpan`; the send in `withSpan("mail.send", "mail", { "mail.kind": kind }, ...)`), `src/jobs/heartbeat.ts` (unchanged: not traced), `src/start-worker.ts` (start line `environment`)
- Test: `apps/worker/src/monitoring-spawn.test.ts`, `src/main.test.ts`, `src/env.test.ts`

**Interfaces:**

- Consumes: Task 1's `readMonitoringSettings`, `startServerMonitoring`, `runJobInSpan`, `withSpan`, `flushMonitoring`, `closeMonitoring`, `startFakeSentry`.

- [ ] **Step 1: Write the failing tests.** `monitoring-spawn.test.ts`: spawn `src/main.ts` with a test database, the SMTP settings of `main.test.ts` and a fake Sentry DSN; wait for "Worker started"; queue a mail job for a membership that does not exist (`queueMail` from `@padvinder/db` in a transaction, kind `added-to-working-group`, random UUIDs), so the worker drops it after loading; wait until the fake server has a transaction named `mail`; SIGTERM. Expect that transaction to carry the tags `job.name` `mail` and a `job.id`, at least one `db` span, and `service` `worker`; no transaction named `heartbeat`. `main.test.ts`: the "Worker started" line has `environment`.
- [ ] **Step 2: Run them to verify they fail.** Run: `pnpm vitest run --project worker`. Expected: FAIL.
- [ ] **Step 3: Implement** as in Task 2 (`main.ts` → monitoring → `await import("./run")`), with `installCrashHandlers(logger, { beforeExit: () => flushMonitoring() })` and `closeMonitoring()` after the worker stops.
- [ ] **Step 4: Run the worker's tests and `pnpm --filter @padvinder/worker build`.** Expected: PASS; `dist` holds `.map` files.
- [ ] **Step 5: Commit.** `git commit -m "Report the worker's errors and job traces to Sentry"`

### Task 4: Source maps, provisioning and the Deploy upload

**Files:**

- Create: `scripts/sentry-cli.sh` (runs `getsentry/sentry-cli:3.8.2` in Docker with the repository mounted, passing through `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_URL`; the image tag in one variable), `scripts/upload-sourcemaps.sh`
- Modify: `scripts/build-release.sh` (after the `pnpm deploy` copies: `scripts/sentry-cli.sh sourcemaps inject release/api/dist release/worker/dist`, then move every `*.map` under `release/{api,worker}/dist` to `release/sourcemaps/{api,worker}/`, keeping relative paths; fail when `release/api/dist` or `release/worker/dist` still holds a `.map`)
- Modify: `.github/workflows/deploy.yml` (in the `staging` and the `production` job, a step "Upload source maps" before "Deploy": `tar -xzf padvinder-release.tar.gz release/sourcemaps` then `scripts/upload-sourcemaps.sh release/sourcemaps`, with `env: SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}`, `SENTRY_ORG: ${{ vars.SENTRY_ORG }}`, `continue-on-error: true`)
- Modify: `scripts/lib/ci-jobs.ts` and its test (the two new scripts belong to the release and deploy rules, like `build-release.sh`)
- Modify: `infra/alwaysdata/src/env-file.ts` (`PADVINDER_ENVIRONMENT=<env>` and `SENTRY_DSN=<secret>`), `src/config.ts` (`SENTRY_DSN` is a required env-file secret, checked with the same unquoted-value rule; `LoginSecrets` gains `sentryDsn`, or a sibling `MonitoringSecrets` — the builder picks, one place), `src/cli/provision.ts` (`secretsOf` includes the DSN), `.github/workflows/provision.yml` (`SENTRY_DSN: ${{ secrets.SENTRY_DSN }}`), and their tests

**Interfaces:**

- Consumes: the `.map` files from Tasks 2 and 3.
- Produces: `release/sourcemaps/` in the tarball; `scripts/upload-sourcemaps.sh <dir>` (exits 0 with a warning and uploads nothing when `SENTRY_AUTH_TOKEN` is empty; otherwise `sourcemaps upload --org "$SENTRY_ORG" --project padvinder <dir>` against `SENTRY_URL` default `https://de.sentry.io`).

- [ ] **Step 1: Write the failing tests.** Infra: `renderEnvFile` writes `PADVINDER_ENVIRONMENT=staging` / `production` and `SENTRY_DSN=...`; `loadInfraConfig` without `SENTRY_DSN` throws naming it (and nothing else changes); a DSN with a space, quote or `#` is refused naming `SENTRY_DSN`; `runProvision`'s redaction hides the DSN. `ci-jobs`: a change to `scripts/sentry-cli.sh` or `scripts/upload-sourcemaps.sh` runs `release` and `deploy-test`.
- [ ] **Step 2: Run them to verify they fail.** Run: `pnpm vitest run --project infra-alwaysdata` and `pnpm vitest run --project scripts`. Expected: FAIL.
- [ ] **Step 3: Implement** the infra, scripts and workflow changes.
- [ ] **Step 4: Run the tests and a local release.** `pnpm vitest run --project infra-alwaysdata`, `pnpm vitest run --project scripts`, `pnpm lint:workflows`, then `pnpm release:build --allow-dirty` (needs Docker): `release/sourcemaps/api` and `release/sourcemaps/worker` hold `.map` files, `release/api/dist` and `release/worker/dist` hold none, and `grep -l "_sentryDebugIds" release/api/dist/*.js` finds the bundles. Then `pnpm release:image && pnpm release:smoke`. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "Inject debug IDs into the server bundles, upload their source maps on deploy, provision the Sentry settings"`

### Task 5: Documentation and the full check

**Files:**

- Modify: `infra/alwaysdata/README.md`, `AGENTS.md`, `.env.example`

- [ ] **Step 1: `infra/alwaysdata/README.md`.**
  - A section "Sentry": the one-time checklist from the spec's "Sentry: the organization" (EU region, project `padvinder`, Security & Privacy, AI features off, inbound filters, spike protection, the DSN key's rate limit, alert rules for `production` including feedback, the uptime monitor on `https://padvinder.net/api/health` every minute, weekly report, GitHub integration if free, the organization auth token), each as a checkbox line.
  - The secrets table: `SENTRY_DSN` (Secret, per environment, the project's DSN; the same value in both is fine) and `SENTRY_AUTH_TOKEN` (Secret, both environments, organization auth token for source map uploads); the variable `SENTRY_ORG` (repository variable, the organization's slug). The env file paragraph names `PADVINDER_ENVIRONMENT` and `SENTRY_DSN`. The rotation schedule gets both secrets (rotate the token yearly with the other API keys; the DSN only on suspicion of abuse, by making a new key in Sentry).
  - "Rolling out Sentry": the spec's "Rolling out" steps, plus that a deploy before Provision runs with Sentry off.
  - The "Verification" table: the rows of the spec's "Verification on Alwaysdata" for the server (the test error via `curl -X POST https://staging.padvinder.net/api/system/test-error` with a platform admin's session cookie; the uptime monitor mailing within about four minutes; memory of API and worker with Sentry; the Node version on Alwaysdata is at least 24.13 so the module hooks are stable — Sentry logs a warning otherwise), each `OPEN`.
- [ ] **Step 2: `AGENTS.md`.**
  - Tech stack, "Backend and hosting": a row "Error tracking | Sentry (SaaS, EU region, free Developer plan) through `@sentry/node` 11.18.0 (exact) in `packages/monitoring`; no Sentry Logs, Replay or AI features | Decided".
  - A subsection "Monitoring" under "Architecture rules" after "Logging": Sentry starts in `main.ts` before anything imports `pg`, the rest loads by dynamic import (and why); `error` lines become issues; the data-collection rule (every category off, only `{ id }` as user, `scrub` on everything); tracing exclusions; `withSpan` / `runJobInSpan`; `setMonitoringUser`; tests use `createTestTransport` / `startFakeSentry` from `@padvinder/monitoring/testing`; `POST /api/system/test-error`; Sentry is off without `SENTRY_DSN`.
  - "Repository layout": `monitoring/` under `packages/`. "Release": `release/sourcemaps/` and that the deploy uploads it. "CI": the Deploy workflow's upload step uses `SENTRY_AUTH_TOKEN`; the CI workflow still uses no secrets. The "Development workflow" details: `.env.example` lists `SENTRY_DSN` (empty) and `PADVINDER_ENVIRONMENT`.
  - "Current state": one sentence for this pull request (2 of 3).
- [ ] **Step 3: Run `pnpm format` on the changed docs, then `pnpm check`.** Expected: exit 0.
- [ ] **Step 4: Commit.** `git commit -m "Document Sentry: the organization checklist, secrets, rollout and verification"`
