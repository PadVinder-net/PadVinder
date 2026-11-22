# Deployment and Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pull request 3 of the monorepo setup: an idempotent provisioning script for Alwaysdata, a deploy workflow (staging on every merge to `main`, production after approval) that ships the release tarball of pull request 2, migrates on the server, switches and restarts, checks health and rolls back on failure, and the Alwaysdata verification with its results.

**Architecture:** A new workspace package `infra/alwaysdata` (TypeScript, run with plain `node`) holds a small Alwaysdata REST client, the desired state of each environment, a reconciler (plan, then apply), and a deploy orchestrator. Everything that touches the server goes through two narrow interfaces, `AlwaysdataApi` and `Remote` (SSH and rsync), so the logic is unit-tested against fakes, and the SSH side is integration-tested against a local "fake host" container. Workflows only call the CLIs. Secrets live in GitHub environments and reach the server only through provisioning, which writes one env file per environment.

**Tech Stack:** Node 24 (type stripping), TypeScript 7, Zod 4, Vitest 5, OpenSSH and rsync, Docker, GitHub Actions environments, the Alwaysdata REST API v1.

**Spec:** `docs/superpowers/specs/2026-11-21-monorepo-setup-design.md`, sections "Deployment", "Provisioning (`infra/alwaysdata/`)", "Database locale", "Alwaysdata verification", and item 3 of "Order of work". Read it, `AGENTS.md`, and the release contract of pull request 2 (AGENTS.md "Release", `scripts/build-release.sh`) before any task. Research notes on the Alwaysdata API (public docs, 21 November 2026): `.context/alwaysdata-api-research.md`.

> **Superseded in part, 22 November 2026.** Later the same day the `staging/**` and `provision/<env>` push triggers were removed again (both environments now allow `main` only, because one Alwaysdata account holds both), `deploy-test` moved to its own path-filtered workflow and is no longer a required check, the deploy key reaches ssh through a dedicated ssh-agent instead of a file, and provisioning creates no SSH user: provisioning and deploys log in as the account's main SSH user `<account>`, and the services set no `ssh_user`. The lines below that say otherwise are history; `infra/alwaysdata/README.md` and the spec's "Notes after implementation" are current.

## Global Constraints

- AGENTS.md applies in full. The repository is public: no secrets, real personal data, account names, IP addresses or passwords in commits, workflow files, logs or pull request text. Every secret is passed through environment variables or stdin, never through a command-line argument, and every log line that could hold one goes through `redact()` (Task 1).
- Pull request 2's release contract is fixed: the tarball `padvinder-release.tar.gz` holds `release/` with `api/`, `worker/`, `mobile/`, `portal/`, `migrations/`, `release.env`, `release.json`. Start from inside a release directory: `node --env-file=release.env --env-file=<env file> api/dist/main.js` (same for `worker/dist/main.js`), migrate with `node --env-file=release.env --env-file=<env file> api/dist/migrate.js migrations`.
- Server layout per environment `<env>` (`staging` or `production`), relative to the account home `/home/<account>`: `padvinder/<env>/.env` (mode 600, written only by provisioning), `padvinder/<env>/releases/<YYYYMMDDTHHMMSSZ>-<sha7>/` (one per deploy), `padvinder/<env>/current` (symlink to the live release, switched atomically). Keep the 5 newest releases plus `current`'s target.
- Environments (exact): production addresses `padvinder.net`, API port `8300`, `ALLOWED_ORIGINS=https://padvinder.net`; staging addresses `staging.padvinder.net`, API port `8301`, `ALLOWED_ORIGINS=https://staging.padvinder.net`. Alwaysdata service ports must be in 8300–8499 and services listen on `::`. Database host `postgresql-<account>.alwaysdata.net`, port `5432` (never pgBouncer's 5433). SSH host `ssh-<account>.alwaysdata.net`.
- Resource names: database and database user `<account>_<env>`; SSH user `<account>_deploy` (history: replaced by the main SSH user `<account>`, see the note above); site name `padvinder-<env>`; services identified by `annotation` exactly `padvinder-api (<env>)` and `padvinder-worker (<env>)`. Every service gets `NODEJS_VERSION=24` in its `environment` and nothing else there.
- Database: PostgreSQL, encoding `UTF8`, locale `C.UTF-8`, extension `postgis` only. Locale and extensions can only be set at creation; the reconciler never recreates or drops an existing database, and reports a mismatch instead.
- The Alwaysdata API: base `https://api.alwaysdata.com/v1/`, Basic auth with username `<api key> account=<account>` and an empty password, JSON, `PATCH` for updates, `POST /v1/service/<id>/restart/` to restart. Rate limit about 50 writes and 250 reads per minute: the client spaces requests and retries `429` and `5xx` with backoff (3 tries). Fields that the public docs do not name (reverse proxy URL, database locale and extensions) are marked `UNVERIFIED` in one file, `infra/alwaysdata/src/resources.ts`, and confirmed against the real account in Task 9.
- GitHub configuration names (exact). Environments `staging` and `production`. Secrets in each: `ALWAYSDATA_API_KEY`, `DEPLOY_SSH_KEY` (private key), `DATABASE_PASSWORD`, `ALWAYSDATA_ACCOUNT`, `SSH_KNOWN_HOSTS` (five secrets, no variables: the account name and the known-hosts line would show in the public logs of a step that gets them from `vars`). The CLIs read the same names from the environment.
- Exact versions as in pull request 2. Actions pinned by full SHA as in `.github/workflows/ci.yml`. Fake host base image `node:24-bookworm-slim`.
- Stop points (the maintainer decides): adding the GitHub secrets and variables; the first run of anything against the real Alwaysdata account (even read-only); the first deploy to staging; anything that touches production. Build and test everything else first. Never change repository settings; document them.
- AGENTS.md: edit only "Current state", "Development workflow" (commands), "Planned workflow" / deployment and the CI section. Slice 1 is specified in another workspace at the same time.
- Commit after every task, message in English, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A deploy fails halfway** (migration error, rsync drop, health check fails after the switch). The live version must stay up or be put back: migrate before the switch, and on a failed health check switch `current` back and restart. Pinned by Task 4's rollback and failed-migration tests, and the fake host test.
2. **Provisioning runs twice, or after a manual change in the panel.** The second run must make no writes, and must never drop or recreate a database. Pinned by Task 3's "second apply makes no writes" and "database locale mismatch is reported, not fixed" tests.
3. **A secret leaks into a public log** (an API error echoing the request, a `DATABASE_URL` in an exception, an SSH command line). Pinned by Task 1's `redact` tests, Task 3's "plan output never contains the password" test, and the rule that secrets travel only through env and stdin.
4. **The health check passes for the wrong reason** (the old process still answers, a stale heartbeat from before the restart, a cached response). It must require the new commit and a heartbeat newer than the restart. Pinned by Task 4's health check tests.
5. **Two deploys at once, or a deploy while production waits for approval.** Releases must not overwrite each other, and production must only ever get a commit that passed staging. Pinned by the release directory naming (timestamp plus commit), the workflow concurrency groups and `needs:` in Task 6.

---

### Task 1: The `infra/alwaysdata` package and the API client

**Files:**

- Create: `infra/alwaysdata/package.json` (`@padvinder/infra-alwaysdata`, private, ESM, dependency `zod`), `tsconfig.json`, `vitest.config.ts` (project name `infra-alwaysdata`, excluding `*.fake-host.test.ts`), `src/api.ts`, `src/redact.ts`, `src/testing/fake-api.ts`
- Modify: `pnpm-workspace.yaml` (add `infra/*`), root `vitest.config.ts` (add `infra/*` to projects)
- Test: `infra/alwaysdata/src/api.test.ts`, `src/redact.test.ts`

**Interfaces:**

- Produces:
  - Files run with plain `node` (type stripping): imports use the `.ts` extension, no enums or parameter properties.
  - `redact(text: string, secrets: readonly string[]): string`: replaces every non-empty secret, and its `encodeURIComponent` form, with `***`; also replaces the password part of any `postgres://user:password@` URL.
  - `type Resource = { id: number; [field: string]: unknown }`, `type ResourceKind = "site" | "database" | "database/user" | "ssh" | "service"`.
  - `interface AlwaysdataApi { list(kind): Promise<Resource[]>; create(kind, body): Promise<Resource>; update(kind, id, patch): Promise<void>; restartService(id): Promise<void> }`.
  - `createAlwaysdataApi(options: { apiKey: string; account: string; fetch?: typeof fetch; baseUrl?: string; minIntervalMs?: number }): AlwaysdataApi`. `create` does not trust the POST response to carry the object: it lists again and returns the new resource (matched by the caller-provided identity field, see Task 2), so the client works whatever the POST body holds. Errors are `AlwaysdataError` with method, path, status and the response body passed through `redact` with the API key.
  - `startFakeAlwaysdata(): Promise<{ baseUrl: string; resources: Map<ResourceKind, Resource[]>; requests: { method: string; path: string; body: unknown }[]; failNext(status: number): void; close(): Promise<void> }>` (test helper): an in-memory server with the routes above, assigning ids, requiring the Basic auth header, answering `POST` with `201` and an empty body.

- [ ] **Step 1: Write the failing tests.**

```ts
// redact.test.ts
test("hides a secret and its URL-encoded form", () =>
  expect(redact("pw=a/b+c url=a%2Fb%2Bc", ["a/b+c"])).toBe("pw=*** url=***"));
test("hides the password in a postgres URL", () =>
  expect(redact("postgres://u:s3cret@host:5432/db", [])).toBe("postgres://u:***@host:5432/db"));

// api.test.ts (against startFakeAlwaysdata)
test("sends Basic auth with the account in the username", ...); // header = "Basic " + base64("KEY account=acme:")
test("create returns the new resource even when POST has no body", ...);
test("update sends PATCH with only the given fields", ...);
test("retries a 429 and a 503, then succeeds", ...);
test("an error names method, path and status, without the API key", async () => {
  fake.failNext(400);
  await expect(api.list("site")).rejects.toThrow(/GET \/v1\/site\/ failed with 400/);
  // and the message does not contain the key
});
```

- [ ] **Step 2: Run them.** `pnpm vitest run --project infra-alwaysdata`. Expected: FAIL.
- [ ] **Step 3: Implement** the package, `redact.ts`, `api.ts` and the fake.
- [ ] **Step 4: Run them, then the whole check.** `pnpm vitest run --project infra-alwaysdata && pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the Alwaysdata API client"`

---

### Task 2: `Remote` over SSH, and a fake host to test it

**Files:**

- Create: `infra/alwaysdata/src/remote.ts`, `infra/alwaysdata/test/fake-host/Dockerfile`, `infra/alwaysdata/test/fake-host/entrypoint.sh`, `infra/alwaysdata/src/testing/fake-host.ts`
- Test: `infra/alwaysdata/src/remote.fake-host.test.ts`

**Interfaces:**

- Produces:
  - `interface Remote { exec(command: string, options?: { stdin?: string; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string }>; writeFile(path: string, content: string, mode: number): Promise<void>; upload(localDir: string, remoteDir: string, options?: { linkDest?: string }): Promise<void> }`. Remote paths are relative to the SSH user's home.
  - `createSshRemote(options: { host: string; port?: number; user: string; keyFile: string; knownHostsFile: string }): Remote`: `ssh` with `-i`, `-o UserKnownHostsFile=<file>`, `-o StrictHostKeyChecking=yes`, `-o BatchMode=yes`, `-o ConnectTimeout=15`; `upload` runs `rsync -a --delete` over the same SSH options (`--link-dest` when given, so unchanged files such as `node_modules` are hard links, not copies). `env` values are sent over stdin as `export` lines, never on the command line. A failing command throws with the command (not its stdin) and redacted stderr.
  - `startFakeHost(options: { databaseUrlFromHost: string }): Promise<{ remote: Remote; homeDir: string; exec(cmd: string): Promise<string>; stop(): Promise<void> }>` (test helper): builds and runs the fake host image (OpenSSH on a random local port, user `padvinder`, `node:24-bookworm-slim`, rsync, `--add-host=host.docker.internal:host-gateway`), with a fresh ed25519 key pair and a known-hosts file from `ssh-keyscan`.
  - Root `package.json`: `test:fake-host` runs `vitest run --project infra-alwaysdata --config infra/alwaysdata/vitest.fake-host.config.ts` (only `*.fake-host.test.ts`; needs Docker; not part of `pnpm test`). Create that config.

- [ ] **Step 1: Write the failing integration tests.**

```ts
test("exec runs a command and returns stdout", ...);          // "echo hi" → "hi\n"
test("env values reach the command but not its argv", ...);   // env { SECRET: "x" }; `ps` during a sleep does not show "x"
test("writeFile writes atomically with the given mode", ...); // stat -c %a → 600
test("upload with linkDest hard-links unchanged files", ...); // inode of an unchanged file equal in both dirs
test("a failing command throws with its stderr", ...);
test("an unknown host key is refused", ...);                   // empty known_hosts file → rejects
```

- [ ] **Step 2: Run them.** `pnpm test:fake-host`. Expected: FAIL.
- [ ] **Step 3: Implement** `remote.ts`, the image and the helper.
- [ ] **Step 4: Run them, then the whole check.** `pnpm test:fake-host && pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Run commands and upload releases over SSH, tested against a fake host"`

---

### Task 3: Provisioning: desired state, plan and apply

**Files:**

- Create: `infra/alwaysdata/src/environments.ts`, `src/resources.ts`, `src/reconcile.ts`, `src/env-file.ts`, `src/config.ts`, `src/cli/provision.ts`
- Modify: root `package.json` (`infra:provision`)
- Test: `infra/alwaysdata/src/reconcile.test.ts`, `src/env-file.test.ts`, `src/config.test.ts`

**Interfaces:**

- Consumes: `AlwaysdataApi`, `redact`, `startFakeAlwaysdata` (Task 1); `Remote`, `createSshRemote` (Task 2; faked in the tests).
- Produces:
  - `type EnvironmentName = "staging" | "production"`; `environments: Record<EnvironmentName, { addresses: string[]; apiPort: number; allowedOrigins: string[] }>` with the values from Global Constraints.
  - `loadInfraConfig(source: Record<string, string | undefined>, environment: EnvironmentName): InfraConfig` reading `ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`, `DATABASE_PASSWORD` (provisioning only), `DEPLOY_SSH_KEY_FILE` (path of the private key file the workflow writes), `SSH_KNOWN_HOSTS_FILE`; errors name every missing variable and never print a value.
  - `desiredResources(account: string, env: EnvironmentName, databasePassword: string): DesiredResource[]` in `resources.ts`, one entry per resource with `{ kind, identity: { field, value }, fields, createOnly?: string[] }`, in dependency order: SSH user, database, database user (permission `FULL` on its database), site (type `reverse_proxy`, `ssl_force: true`, proxy target `http://services-<account>.alwaysdata.net:<apiPort>`), API service (command `node --env-file=release.env --env-file=/home/<account>/padvinder/<env>/.env api/dist/main.js`, `working_directory: padvinder/<env>/current`), worker service (same with `worker/dist/main.js`). Type-specific field names that the docs do not confirm carry a `// UNVERIFIED` comment.
  - `type PlannedChange = { action: "create" | "update" | "ok" | "conflict"; kind; identity: string; fields?: string[]; reason?: string }`.
  - `planResources(api, desired): Promise<PlannedChange[]>`: lists each kind once, matches by identity, compares only the desired fields. A password is write-only: it is set on create, and on update only when `--rotate-password` is given. A difference in a `createOnly` field is a `conflict` with a reason, never an update.
  - `applyPlan(api, desired, plan): Promise<void>`: performs creates and updates in order; refuses to run when the plan has a conflict.
  - `renderEnvFile(input: { account; env; databasePassword }): string`: `DATABASE_URL` (password URL-encoded, host and port from Global Constraints, database `<account>_<env>`), `API_HOST=::`, `API_PORT`, `ALLOWED_ORIGINS`, `LOG_LEVEL=info`. One `KEY=value` per line, a header comment saying provisioning writes it and not to edit it on the server.
  - `cli/provision.ts --environment <env> [--apply] [--rotate-password] [--inspect]`: prints the plan (one line per change, redacted). Without `--apply` it changes nothing. With `--apply` it applies, then writes the env file through `Remote.writeFile("padvinder/<env>/.env", ..., 0o600)` (content over stdin to a temp file, then `mv`) and creates `padvinder/<env>/releases`. `--inspect` only lists every resource of each kind as JSON with password-like fields removed, for confirming the `UNVERIFIED` field names. Exit 1 on conflict or error.

- [ ] **Step 1: Write the failing tests** (against `startFakeAlwaysdata` and a fake `Remote`).

```ts
test("an empty account plans six creates in dependency order", ...); // ssh, database, database/user, site, service, service
test("apply then plan again: everything ok and no further writes", async () => {
  await applyPlan(api, desired, await planResources(api, desired));
  const writes = fake.requests.filter((r) => r.method !== "GET").length;
  expect((await planResources(api, desired)).every((c) => c.action === "ok")).toBe(true);
  await applyPlan(api, desired, await planResources(api, desired));
  expect(fake.requests.filter((r) => r.method !== "GET").length).toBe(writes);
});
test("a changed service command becomes an update of only that field", ...);
test("a database locale mismatch is a conflict, and apply refuses", ...);
test("the password is not compared, and is only sent with --rotate-password", ...);
test("plan output never contains the password", ...); // run the CLI's print function with a password containing "/" and "+"
test("renderEnvFile encodes the password in DATABASE_URL", ...); // password "p@ss/w+rd" → p%40ss%2Fw%2Brd
test("loadInfraConfig names every missing variable without values", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run them, then the whole check.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Plan and apply the Alwaysdata resources of an environment"`

---

### Task 4: The deploy orchestrator

**Files:**

- Create: `infra/alwaysdata/src/deploy.ts`, `src/health-check.ts`, `src/services.ts`, `src/cli/deploy.ts`, `src/cli/services.ts`
- Modify: root `package.json` (`infra:deploy`, `infra:services`)
- Test: `infra/alwaysdata/src/deploy.test.ts`, `src/health-check.test.ts`, `src/deploy.fake-host.test.ts`

**Interfaces:**

- Consumes: `AlwaysdataApi` (Task 1), `Remote`, `startFakeHost` (Task 2), `environments` and the service identities (Task 3).
- Produces:
  - `findServices(api, env): Promise<{ api: Resource; worker: Resource }>` (by annotation; throws naming the missing one). `setServicesEnabled(api, env, enabled: boolean)` patches `is_disabled`.
  - `checkHealth(options: { url: string; commit: string; heartbeatAfter: Date; timeoutMs?: number; intervalMs?: number; fetch?: typeof fetch }): Promise<void>`: polls `<url>/api/health` (`Cache-Control: no-cache`, a cache-busting query) until HTTP 200, `commit` equal to the expected commit, `status` `ok`, and `worker.lastHeartbeatAt` later than `heartbeatAfter`. Defaults: timeout 180 s, interval 5 s. On timeout it throws with the last response's status and body (no secrets in it).
  - `deploy(options: { env; commit: string; releaseDir: string; api: AlwaysdataApi; remote: Remote; healthUrl: string; now?: () => Date; keepReleases?: number }): Promise<void>`, in this order:
    1. `releases/<UTC YYYYMMDDTHHMMSSZ>-<sha7>`; refuse if it exists.
    2. `upload(releaseDir, that dir, { linkDest: current's target if any })`.
    3. Migrate: `exec` in the new dir, `NODEJS_VERSION=24 node --env-file=release.env --env-file=$HOME/padvinder/<env>/.env api/dist/migrate.js migrations`. A failure stops the deploy before the switch and removes the new dir.
    4. Remember the previous target, switch `current` atomically (`ln -sfn <target> current.tmp && mv -T current.tmp current`).
    5. Enable the services if disabled, record `restartedAt`, restart the API and worker services.
    6. `checkHealth` with `heartbeatAfter: restartedAt`. On failure: switch `current` back to the previous target (if any), restart both services, and throw `Deploy of <sha7> failed its health check and was rolled back to <previous>`.
    7. Prune: keep the newest `keepReleases` (default 5) directories plus the target of `current`.
       Each step logs one line.
  - `cli/deploy.ts --environment <env> --tarball <path> --commit <sha> [--health-url <url>]`: unpacks the tarball to a temp dir, checks `release.env`'s `GIT_COMMIT` equals `--commit`, builds the API client and SSH remote from `loadInfraConfig`, and runs `deploy`. Default health URL `https://<first address>`.
  - `cli/services.ts --environment <env> (--enable | --disable | --restart)`.

- [ ] **Step 1: Write the failing unit tests** (fake API, a fake `Remote` that records commands and simulates a filesystem, fake health server).

```ts
test("runs upload, migrate, switch, restart, health, prune in this order", ...);
test("a failed migration stops before the switch and removes the new release", ...);
test("a failed health check switches back and restarts again", ...);
test("the first deploy (no previous release) fails without trying to roll back", ...);
test("prune keeps five releases and never the current target", ...);
test("refuses a tarball whose GIT_COMMIT differs from --commit", ...);
// health-check.test.ts
test("waits until the new commit answers", ...);                      // old commit twice, then new → resolves
test("does not accept a heartbeat from before the restart", ...);      // lastHeartbeatAt < heartbeatAfter → keeps polling
test("times out with the last status and body", ...);
```

- [ ] **Step 2: Write the failing fake host test** (`deploy.fake-host.test.ts`): unpack the real `padvinder-release.tar.gz` (skip with a clear message if missing; CI provides it), create a fresh database on the local or CI PostGIS, write the env file through `Remote.writeFile`, run `deploy` twice with different fake commits (patch `release.env` in a copy) and a fake API and health server. Expect: two release dirs, `current` pointing at the second, the migrations table filled, the second upload hard-linked against the first (`node_modules` inode equal), and a third deploy with a failing health check leaving `current` on the second.
- [ ] **Step 3: Run them.** `pnpm vitest run --project infra-alwaysdata && pnpm test:fake-host`. Expected: FAIL.
- [ ] **Step 4: Implement** the files above.
- [ ] **Step 5: Run them, then the whole check.** `pnpm release:build --allow-dirty && pnpm test:fake-host && pnpm check`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Deploy a release with migrations, a health check and rollback"`

---

### Task 5: The apps under a service supervisor, and the build number

**Files:**

- Modify: `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `apps/mobile/package.json` (`"version": "2027.0.0"`), `apps/mobile/vite.config.ts`, `apps/mobile/src/app-version.ts`, `apps/mobile/src/vite-env.d.ts`, `apps/mobile/src/screens/more-screen.tsx`, `scripts/build-release.sh`
- Test: `apps/api/src/main.test.ts`, `apps/worker/src/main.test.ts`, `apps/mobile/vite.config.test.ts`, `apps/mobile/src/screens/more-screen.test.tsx`

**Interfaces:**

- Produces:
  - API and worker treat `SIGHUP` like `SIGTERM` (graceful shutdown, exit 0): Alwaysdata's service restart sends `SIGHUP` and starts the process again when it exits.
  - The app version's single source is `apps/mobile/package.json` `version`. The Vite config uses it when `PADVINDER_APP_VERSION` is unset or empty (still validated as CalVer), and `build-release.sh` writes the same value to `release.json`.
  - `PADVINDER_BUILD_NUMBER` (the CI run number; default `dev`) is stamped as `__APP_BUILD__`; `APP_BUILD: string` in `app-version.ts`; `release.json`'s `build` reads it (replacing `GITHUB_RUN_NUMBER`).
  - `MoreScreen` shows below the system status: `App-versie {APP_VERSION} (build {APP_BUILD})`.

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/api/src/main.test.ts and the worker's
test("SIGHUP shuts down cleanly with exit 0", ...); // start with a valid env against the test database, wait for the listen/start log line, kill("SIGHUP") → code 0
// apps/mobile/vite.config.test.ts
test("defaults the app version to package.json's version", ...);
test("stamps PADVINDER_BUILD_NUMBER, defaulting to dev", ...);
// more-screen.test.tsx
test("shows the app version and build", ...); // "App-versie 2027.0.0 (build dev)"
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, then the whole check.** `pnpm check && pnpm test:e2e`. Expected: PASS. Visual references are unchanged (no `packages/ui` change).
- [ ] **Step 5: Commit.** `git commit -m "Restart cleanly on SIGHUP and stamp the build number"`

---

### Task 6: The workflows

**Files:**

- Create: `.github/workflows/deploy.yml`, `.github/workflows/provision.yml`, `.github/workflows/staging-services.yml`, `.github/actions/alwaysdata-credentials/action.yml`
- Modify: `.github/workflows/build-release.yml` (inputs `build-number`, `retention-days`; output `artifact-name`), `.github/workflows/ci.yml` (job `deploy-test`)

**Interfaces:**

- Consumes: every CLI from Tasks 3–4.
- Produces:
  - `build-release.yml`: new inputs `build-number` (string, default empty → `PADVINDER_BUILD_NUMBER` unset) and `retention-days` (number, default 7); output `artifact-name` (`release-<sha>`).
  - Composite action `alwaysdata-credentials`: writes `DEPLOY_SSH_KEY` to `$RUNNER_TEMP/deploy_key` (mode 600) and `SSH_KNOWN_HOSTS` to `$RUNNER_TEMP/known_hosts`, and exports `DEPLOY_SSH_KEY_FILE` and `SSH_KNOWN_HOSTS_FILE`. Inputs come through `env:`, never interpolated into `run:`. A final step of each job that uses it removes the key (`if: always()`).
  - `deploy.yml`, name `Deploy`, triggers `push` to `main` and to `staging/**` (the `staging/**` trigger was removed later, see the note at the top), and `workflow_dispatch`; `permissions: contents: read`. Jobs:
    - `release`: `uses: ./.github/workflows/build-release.yml` with `build-number: ${{ github.run_number }}`, `retention-days: 30`.
    - `staging` (needs `release`; `environment: { name: staging, url: https://staging.padvinder.net }`; `concurrency: { group: deploy-staging, cancel-in-progress: false }`; timeout 20): checkout, setup, download the artifact, credentials, `pnpm infra:deploy --environment staging --tarball padvinder-release.tar.gz --commit ${{ github.sha }}`.
    - `production` (needs `staging`; `if: github.ref == 'refs/heads/main'`; `environment: { name: production, url: https://padvinder.net }`; group `deploy-production`; timeout 20): the same for production. The environment's required reviewers are the approval.
  - `provision.yml`, name `Provision`, `workflow_dispatch` with inputs `environment` (choice staging/production) and `apply` (boolean, default false), and `push` to branches `provision/staging` and `provision/production` (plan only, environment from the branch name). One job in that environment: credentials, `pnpm infra:provision --environment <env>` plus `--apply` only when the dispatch input says so. (The push triggers were removed later, see the note at the top.)
  - `staging-services.yml`, `workflow_dispatch` with input `state` (choice on/off): `pnpm infra:services --environment staging --enable|--disable`.
  - `ci.yml` job `deploy-test` (needs `release`; timeout 15; PostGIS service as in `check`): download `release-${{ github.sha }}`, `pnpm test:fake-host`.
  - Required check list in `docs/repository-settings.md` gains `deploy-test` (Task 7). (Removed again later, see the note at the top.)

- [ ] **Step 1: Write the workflows.**
- [ ] **Step 2: Lint and test.** `pnpm lint:workflows && pnpm vitest run --project scripts && pnpm check`. Expected: PASS.
- [ ] **Step 3: Commit.** `git commit -m "Deploy to staging on every merge and to production after approval"`

---

### Task 7: Documentation

**Files:**

- Create: `infra/alwaysdata/README.md`
- Modify: `AGENTS.md` (allowed sections only), `docs/repository-settings.md`, the spec (dated notes for what turned out differently)

- [ ] **Step 1: Write `infra/alwaysdata/README.md`:** what runs where (sites, services, databases, SSH user, server layout); every account and every manual step (API token with 2FA, adding the deploy public key to the SSH user in the panel, the GitHub environments, secrets and variables with how to generate each: `ssh-keygen -t ed25519 -N "" -C padvinder-deploy`, `openssl rand -hex 32`, `ssh-keyscan ssh-<account>.alwaysdata.net`); DNS records as they are, as names and types only (no IP addresses in the repository; say where to read them in the panel); rebuilding everything from scratch on Alwaysdata and on another host (dump and restore, copy files, change DNS); rotating a secret; turning staging off and on; reading logs (`~/admin/logs/services/`); a "Verification" section with one row per spec item and "not yet verified".
- [ ] **Step 2: Update `docs/repository-settings.md`:** environments `staging` (deployment branches `main`, `staging/**`, `provision/staging`) and `production` (required reviewers: the maintainer; deployment branches `main`, `provision/production`; no self-review bypass needed for one maintainer), with their secrets and variables; add `deploy-test` to the required checks. (`staging/**` and `provision/*` were removed later, see the note at the top.)
- [ ] **Step 3: Update `AGENTS.md`:** current state (deployment exists, verification status), the new commands, a short Deployment section replacing the planned one (what happens on merge, how to deploy a branch to staging with `staging/<name>`, how to provision, where the README is).
- [ ] **Step 4: Format and check.** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Document deployment and provisioning"`

---

### Task 8: Pull request and the stop for secrets

- [ ] **Step 1: Push and open the pull request** against `main` (or against pull request 2's branch while that is unmerged, so the diff stays readable). Get every check green, including `deploy-test`. Check out the branch so Conductor shows it.
- [ ] **Step 2: Ask the maintainer** for the GitHub environments, secrets and variables (exact names from Global Constraints and how to make each, from the README), and for approval to run `provision --inspect` against the account. Stop the live thread until they confirm.

---

### Task 9: First provisioning and deploy to staging (after approval)

- [ ] **Step 1: Inspect.** (The `provision/staging` push trigger was removed later, see the note at the top.) Push branch `provision/staging` from this branch (plan only) or, once merged, dispatch `Provision` with `apply: false`; also run `--inspect` the same way. Read the real field names, fix `resources.ts` (remove the `UNVERIFIED` marks that are now confirmed) and its tests, commit.
- [ ] **Step 2: Ask, then apply staging provisioning.** Expected: the plan lists the creates, apply succeeds, a second plan is all `ok`.
- [ ] **Step 3: Ask, then deploy staging** by pushing this branch to `staging/first-deploy`. Expected: the `staging` job passes its health check; `https://staging.padvinder.net/app/` loads.

---

### Task 10: Alwaysdata verification (on staging)

**Files:** `infra/alwaysdata/README.md` ("Verification"), `scripts/sse-soak.ts` (new), the spec (dated note)

- [ ] **Step 1: Write `scripts/sse-soak.ts <url> --hours <n>`**: keeps one `EventSource`-style fetch stream open, logs each event and keepalive with its time, and at the end prints the longest gap and the number of reconnects. Unit-test the gap computation.
- [ ] **Step 2: Run the checks and record each result with the date:**
  - pg-boss: heartbeats every minute (`select count(*), max(beat_at) from worker_heartbeats` over SSH with `psql`, or `/api/health` over time), and a heartbeat within 2 minutes after `infra:services --restart`.
  - SSE: `sse-soak` against `https://staging.padvinder.net/api/events` for an evening (at least 4 hours): keepalives every 25 s, heartbeat events every minute, no gap over 90 s.
  - `LISTEN`/`NOTIFY` on 5432: follows from the SSE heartbeat events.
  - PostGIS: `select postgis_full_version()`; if it says "core procs need upgrade", ask Alwaysdata support (tell the maintainer).
  - Database locale: `select datcollate, datctype, datlocprovider from pg_database where datname = current_database()`.
  - TLS from outside: `openssl s_client -starttls postgres -connect postgresql-<account>.alwaysdata.net:5432` (no credentials needed).
  - Time zone: `date`, `echo $TZ` over SSH, and `show timezone` in PostgreSQL; the heartbeat schedule's time zone from `pgboss.schedule`.
  - Memory: RSS of the API and worker processes after an hour (`ps -o rss,cmd -u $USER` over SSH), for staging; production after its first deploy.
  - SIGHUP: the service restart leaves a clean shutdown line in the log.
- [ ] **Step 3: Decide whether staging stays on by default** from the memory numbers (spec: builder's call), record it in the README, commit, and report the results to the maintainer.

---

### Task 11: Production (only with the maintainer's go-ahead)

- [ ] **Step 1: Ask** before provisioning production. Then plan, apply, and confirm a second plan is all `ok`.
- [ ] **Step 2: Production deploys only from `main`**, behind the environment approval. After the maintainer merges and approves, check `https://padvinder.net/api/health` and record production's memory numbers.
