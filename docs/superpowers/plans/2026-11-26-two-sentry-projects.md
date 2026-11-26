# Two Sentry Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the one Sentry project into two: `padvinder-server` (the API and the worker, DSN `SENTRY_DSN`) and `padvinder-browser` (the app and the portal, DSN `SENTRY_BROWSER_DSN`), so browser noise and a flood through the public tunnel never share settings, alert rules or a rate limit with server errors.

**Architecture:** `readMonitoringSettings` gains `browserDsn`. The API's tunnel and problem reports post to `browserDsn` instead of `dsn`; the server SDK keeps `dsn`. Provisioning writes both DSNs; the Deploy upload sends the server maps and the browser maps to their own project. Decided with the maintainer on 26 November 2026 ("2, sgtm").

**Tech Stack:** as in pull requests 2 and 3 of the logging and monitoring design.

**Spec:** `docs/superpowers/specs/2026-11-26-logging-and-monitoring-design.md` (amended in Task 3).

## Global Constraints

- Project slugs: `padvinder-server` and `padvinder-browser`. Secrets: `SENTRY_DSN` (the server project's DSN) and `SENTRY_BROWSER_DSN` (the browser project's DSN), both in both GitHub environments.
- `SENTRY_BROWSER_DSN` follows every rule of `SENTRY_DSN`: parsed by `parseDsn` (`isHttpsDsn` in infra), an invalid value stops the API with only the variable's name, never the value; redacted from every printed line; required by provisioning.
- Without `SENTRY_BROWSER_DSN` the tunnel answers 204 and drops the envelope, and a problem report is only logged (its length) and answers 204, exactly as today without `SENTRY_DSN`. The server SDK depends only on `SENTRY_DSN`.
- The worker does not read `SENTRY_BROWSER_DSN`.
- Problem reports go to the browser project (they are about what people see). The uptime monitor stays on the server project.
- Nothing else changes in what is collected or scrubbed. `pnpm check` passes.

## Review Focus

- **Only one of the two DSNs set** (a half-done setup): the server reports while the tunnel answers 204, or the other way round; nothing crashes. Pinned in Task 1.
- **The browser DSN in a log line or an error** (a typo in the secret): the error names `SENTRY_BROWSER_DSN`, never the value. Pinned in Tasks 1 and 2.
- **A source map uploaded to the wrong project:** each directory goes to exactly one project. Pinned in Task 2.

---

### Task 1: `browserDsn` in the settings, the tunnel and problem reports

**Files:** `packages/monitoring/src/settings.ts` (+ test), `apps/api/src/routes/sentry-tunnel.ts`, `apps/api/src/routes/problem-reports.ts` (+ their tests), `apps/api/src/testing/login.ts` (if `createTestApp`'s `monitoring` option needs the new field), `.env.example`.

**Interfaces:** `MonitoringSettings` gains `browserDsn: string | undefined` (from `SENTRY_BROWSER_DSN`, empty counts as unset, parsed like `SENTRY_DSN`).

- [ ] **Step 1: Write the failing tests.** Settings: `SENTRY_BROWSER_DSN` read, defaulting to undefined; an invalid one throws naming `SENTRY_BROWSER_DSN` and not the value. Tunnel: with `dsn` set and `browserDsn` unset → 204, nothing forwarded; with `browserDsn` set to the fake server's DSN and `dsn` pointing at a second fake server → the envelope reaches only the browser fake, with the browser DSN's key in the header. Problem reports: the same split (report reaches only the browser fake; without `browserDsn` → 204 and the info log line).
- [ ] **Step 2: Run them to verify they fail.** `pnpm vitest run --project monitoring --project api <files>`.
- [ ] **Step 3: Implement.** `.env.example` gets `SENTRY_BROWSER_DSN=` next to `SENTRY_DSN=`.
- [ ] **Step 4: Run the tests.** Expected: PASS. **Step 5: Commit.**

### Task 2: Provisioning and the source-map upload

**Files:** `infra/alwaysdata/src/env-file.ts`, `src/config.ts`, `src/cli/provision.ts` (+ tests), `.github/workflows/provision.yml`, `scripts/upload-sourcemaps.sh` (+ `scripts/upload-sourcemaps.test.ts`), `.github/workflows/deploy.yml` (only if the script's call changes).

- [ ] **Step 1: Write the failing tests.** The env file holds `SENTRY_BROWSER_DSN=<value>`; `loadInfraConfig` without it throws naming it; an invalid one (not an https DSN, or an unsafe character) is refused naming it; `runProvision` redacts it. The upload: `release/sourcemaps/api` and `release/sourcemaps/worker` go to `padvinder-server`, `release/sourcemaps/mobile` and `release/sourcemaps/portal` to `padvinder-browser` (one `sourcemaps upload --project <slug> <dirs…>` per project); a missing directory is skipped with a warning; without a token, exit 0 and nothing uploaded (as today).
- [ ] **Step 2: Run them to verify they fail.** `pnpm vitest run --project infra-alwaysdata --project scripts`.
- [ ] **Step 3: Implement** (`provision.yml` passes `SENTRY_BROWSER_DSN: ${{ secrets.SENTRY_BROWSER_DSN }}`). Run `pnpm lint:workflows`.
- [ ] **Step 4: Run the tests.** Expected: PASS. **Step 5: Commit.**

### Task 3: The design, the README and AGENTS.md

**Files:** `docs/superpowers/specs/2026-11-26-logging-and-monitoring-design.md`, `infra/alwaysdata/README.md`, `AGENTS.md`, `docs/repository-settings.md`.

- [ ] **Step 1: The design.** Under the status line, a note "Changed on 26 November 2026: two Sentry projects instead of one (see 'Sentry: the organization')". In "Sentry: the organization": two projects, `padvinder-server` (API and worker; the uptime monitor) and `padvinder-browser` (app and portal; problem reports), with the reason (browser-only inbound filters, alert rules tuned per side, a separate rate limit for the public tunnel so a flood cannot crowd out a server outage; traces still join across projects); the API and the worker stay together (same platform, shared packages and release; the `service` tag tells them apart). "Configuration": `SENTRY_BROWSER_DSN`. "The tunnel" and "Problem reports": forwards / posts to the browser DSN. "Rolling out": both DSNs.
- [ ] **Step 2: The README.** The Sentry checklist per project: both made in the EU organization; inbound filters (browser extensions, legacy browsers, web crawlers on the browser project; localhost on both); the DSN key rate limit (browser project, e.g. 300 events an hour; server project higher or none); spike protection on both; alert rules for `production` on each (server: new issue, regression, escalation, the uptime monitor's issue; browser: new issue, regression, escalation, every new problem report); the uptime monitor on the server project; the GitHub integration on both. The secrets table (twelve secrets: add `SENTRY_BROWSER_DSN`), the env file paragraph, the rotation schedule, "Rolling out Sentry" and any verification row naming the project.
- [ ] **Step 3: AGENTS.md** ("Monitoring", "Problem reports", the tech stack row, "CI") and `docs/repository-settings.md`: the two projects and `SENTRY_BROWSER_DSN`.
- [ ] **Step 4: `pnpm format` on the docs, then `pnpm check`.** Expected: exit 0. **Step 5: Commit.**
