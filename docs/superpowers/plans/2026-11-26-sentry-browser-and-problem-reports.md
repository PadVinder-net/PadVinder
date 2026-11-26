# Sentry in the Browser and Problem Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Errors, traces and release health from the mobile app and the portal reach Sentry only through our own API (`POST /api/sentry-tunnel`), crashes show a Dutch crash screen, and every logged-in user can send "Meld een probleem" (`POST /api/problem-reports`), optionally with their name and address (pull request 3 of the logging and monitoring design).

**Architecture:** The browser SDK (`@sentry/react`) sends envelopes to the tunnel with a placeholder DSN. The tunnel parses each envelope, keeps only the item types we use, runs the server's `scrubEvent` over every JSON item, sets the server's environment and release, swaps in the server's DSN and forwards to Sentry's ingest address without any of the phone's headers. Problem reports are built on the server as Sentry user-feedback envelopes (with the account ID, and the name and address from the profile only when asked) and posted with the same forwarding code, so the API knows whether Sentry accepted them. The crash screens and the form are shared components in `packages/ui`.

**Tech Stack:** `@sentry/react` 11.18.0 (exact; same release as `@sentry/node` in pull request 2), `@sentry/core` envelope helpers, Fastify 5, Zod 4 contracts and the generated client, React 19 with React Router, Tailwind/shadcn, Storybook visual tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-logging-and-monitoring-design.md`, sections "The tunnel", "Browser", "Crash screens", "Problem reports", "Source maps", "Tests", "Verification on Alwaysdata". Builds on pull requests 1 (`packages/logging`) and 2 (`packages/monitoring`: `parseDsn`, `scrubEvent`, `UNSAMPLED_PATHS`, `startFakeSentry`, `createTestTransport`).

## Global Constraints

- `@sentry/react` pinned exactly at `11.18.0` in `apps/mobile`, `apps/portal` and the package that holds the browser setup.
- A phone never talks to `sentry.io`: the browser SDK's `tunnel` is `/api/sentry-tunnel`; its DSN is a fixed placeholder (`https://public@padvinder.invalid/1`) that the tunnel ignores.
- Browser `dataCollection`: every category off, as on the server (`userInfo: false`, `cookies: false`, `httpHeaders: false`, `httpBodies: []`, `urlQueryParams: false`, `databaseQueryData: false`, `queues: false`, `stackFrameVariables: false`, `graphQL`/`genAI`/`mcp` all false). The user is only `{ id }` from `/api/me` while logged in, cleared on logging out. No Session Replay, no Sentry feedback widget, no screenshots, no attachments.
- Browser tracing: page loads, navigations (React Router) and API calls; trace headers only to our own `/api/`.
- At most 10 error events per page load (counted in `beforeSend`); more are dropped. Sessions, traces and problem reports do not count.
- Not reported as issues: failed calls without a connection, 4xx answers; a failed chunk load after a deploy reloads the page once instead.
- Sentry in the browser is on only in production builds (`import.meta.env.PROD`); the Vite dev servers (and so the end-to-end tests) run without it.
- The tunnel needs no login, answers 204 and drops the envelope without `SENTRY_DSN`, refuses a body over 200 KB (413) and more than 120 envelopes a minute per client address (429), forwards only to `SENTRY_DSN`'s ingest address with no request header from the phone, and is excluded from server tracing.
- Problem reports: `POST /api/problem-reports`, `requireActor`; strict body; name and address only from the actor's profile and only when `includeContact` is true; message scrubbed (the opt-in contact address is the one exception); 204 when Sentry accepted it or Sentry is off; 502 `report_not_sent` when Sentry could not be reached or refused it; 429 `too_many_reports` after 10 an hour per account.
- Dutch copy exactly as in the spec (sections "Crash screens" and "Problem reports"); "je", sentence case.
- Glossary: add `Meld een probleem` / `problemReport` to AGENTS.md.
- Source maps of the Vite builds: hidden (no `sourceMappingURL`), debug IDs injected, moved to `release/sourcemaps/{mobile,portal}`, uploaded by the existing Deploy step; the served directories hold no maps.
- Visual references only via `pnpm screenshots:update` (Docker); `pnpm check` passes; `pnpm api:generate` output committed.

## Review Focus

- **A browser event carrying personal data** (a breadcrumb of a tap on a member with that person's name, an error message holding an address, `request.headers` with the User-Agent the browser SDK adds): the tunnel's server-side `scrubEvent` removes it even if the browser's settings were wrong. Pinned in Task 2 (tunnel test with a hand-made envelope carrying all three) and Task 4 (breadcrumb test).
- **A forged envelope** (another project's DSN in its header, a `replay_recording` or `attachment` item, invalid JSON, a body that is not an envelope): forwarded only to our DSN, foreign items dropped, garbage answered 400 without reaching Sentry. Pinned in Task 2.
- **Sentry down while a volunteer sends a problem report:** 502 `report_not_sent`, the form keeps the text and shows the Dutch error; nothing is lost silently. Pinned in Task 3 (fake Sentry answering 500 and a closed port) and Task 5 (component test).
- **A spoofed contact** (a body with `name` or `email` fields): 400; the contact always comes from the profile. Pinned in Task 3.
- **A crash before login** (on the login screen): the crash screen shows only "Laad opnieuw", never the report button. Pinned in Task 5.

---

### Task 1: Server follow-ups from pull request 2

**Files:** `packages/monitoring/src/scrub-event.ts` (or `server.ts`), `packages/logging/src/logger.ts`, `apps/api/src/run.ts`, `apps/api/src/start-api.ts`, and their tests.

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests.**
  - Stack-frame file names lose the home directory: an event whose frames have `filename` `/home/someone/padvinder/production/releases/x/api/dist/run-abc.js` and `abs_path` likewise reach the transport as `app:///api/dist/run-abc.js` (relative to the release directory, i.e. `process.cwd()` at start, as Sentry's `rewriteFramesIntegration({ root })` does); unit-test the rewrite with an injected root.
  - The stdout request line's `req.url` is the path without the query: `GET /api/version?email=noor%40example.test&phone=0612345678` logs `url: "/api/version"` (no `0612345678`, no `example.test`).
  - A failing API start (the port is taken) sends its "API failed to start" event to a fake Sentry before exiting 1, also when a cleanup step throws.
- [ ] **Step 2: Run them to verify they fail.** `pnpm vitest run --project monitoring --project logging --project api <files>`. Expected: FAIL.
- [ ] **Step 3: Implement.** `rewriteFramesIntegration({ root: process.cwd(), prefix: "app:///" })` in `startServerMonitoring` (check it keeps debug-ID resolution: debug IDs match by ID, not path); the `req` serializer logs the path only; `run.ts` calls `closeMonitoring()` on the start-failure path whatever `stop()` did. Update AGENTS.md "Logging" (request lines hold the path, not the query) and "Monitoring" (frames are relative to the release).
- [ ] **Step 4: Run the tests.** Expected: PASS. **Step 5: Commit.** `git commit -m "Relative stack frames, path-only request lines, flush a failed API start"`

### Task 2: The tunnel

**Files:**

- Create: `packages/monitoring/src/envelope.ts` (+ test): `prepareBrowserEnvelope` and `forwardEnvelope`
- Create: `apps/api/src/routes/sentry-tunnel.ts` (+ `sentry-tunnel.test.ts`)
- Modify: `apps/api/src/app.ts` (`AppDeps.monitoring?: MonitoringSettings`, register the route), `apps/api/src/run.ts` / `start-api.ts` (pass the settings), `apps/api/src/testing/login.ts` (`createTestApp` option `monitoring`), `packages/monitoring/src/server.ts` (`/api/sentry-tunnel` in the unsampled paths)

**Interfaces:**

- Produces (from `@padvinder/monitoring`):
  - `prepareBrowserEnvelope(body: string | Uint8Array, options: { dsn: string; environment: DeploymentEnvironment; release: string }): Uint8Array | null` — parses with `@sentry/core`'s `parseEnvelope`; returns null for something that is not an envelope or has no JSON item left; keeps only items of type `event`, `transaction`, `session`, `sessions`, `client_report`; runs `scrubEvent` on `event`/`transaction` items and sets their `environment`, `release` and `tags.service` (left as the browser set it: `app` or `portal`); sets `attrs.environment`/`attrs.release` on session items; replaces the envelope header's `dsn` with the server's and drops its `trace.user_*` fields; serializes with `serializeEnvelope`.
  - `forwardEnvelope(envelope: Uint8Array, dsn: string, options?: { timeoutMs?: number }): Promise<{ status: number } | { status: "unreachable" }>` — `POST` to `parseDsn(dsn).ingestUrl` with `Content-Type: application/x-sentry-envelope` and no other header from the client; timeout default 5,000 ms.
- Produces: `POST /api/sentry-tunnel` (no login; body as text up to 200 KB; Sentry's status passed through for 2xx/429, 502 for unreachable or 5xx; 400 for a non-envelope; 413; 429 `too_many_requests` after 120 a minute per client address, the address taken as the login limits take it — `X-Forwarded-For`'s first value, see `apps/api/src/auth/auth.ts`; 204 without a DSN).

- [ ] **Step 1: Write the failing tests** (against `startFakeSentry()`): an envelope from the browser SDK shape (header with a foreign DSN; an `event` item with `message` "send to noor@example.test failed", `user: { id: "u1", ip_address: "{{auto}}", email: "x@y.test" }`, `request: { headers: { "User-Agent": "UA-MARKER" } }`, breadcrumbs with `?email=a%40b.test`; a `replay_recording` item; a `session` item) reaches the fake server once, with the fake's DSN key in the header, no `replay_recording`, `environment`/`release` from the app's settings, `user` `{ id: "u1" }`, and raw bytes without `example.test`, `UA-MARKER`, `a%40b.test` or `y.test`; the request's `Cookie`, `X-Forwarded-For` and `User-Agent` are not among the headers the fake server received. Also: garbage body → 400 and nothing forwarded; 200 KB + 1 → 413; the 121st envelope in a minute from one address → 429; no DSN → 204, nothing forwarded; fake Sentry answering 500 → 502; works without a cookie; a `GET /api/sentry-tunnel` → 404 (POST only). Unit tests for `prepareBrowserEnvelope` cover each item type.
- [ ] **Step 2: Run them to verify they fail.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm vitest run --project monitoring --project api`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the Sentry tunnel: scrub browser envelopes on the server and forward them without the phone's headers"`

### Task 3: Problem reports on the server

**Files:**

- Create: `packages/contracts/src/problem-reports.ts` (`problemReportRequestSchema`, `.meta({ id: "ProblemReportRequest" })`), export it; add `report_not_sent` and `too_many_reports` to `apiErrorCodes` (`packages/contracts/src/errors.ts`)
- Create: `apps/api/src/routes/problem-reports.ts` (+ test); `packages/monitoring/src/feedback.ts` (+ test): `buildFeedbackEnvelope`
- Modify: `apps/api/src/app.ts`; `packages/ui/src/lib/messages.ts` (Dutch texts for the two codes); `packages/api-client/src/` (a `useReportProblem` mutation hook next to the others, exported); run `pnpm api:generate`

**Interfaces:**

- `problemReportRequestSchema = z.strictObject({ message: z.string().trim().min(1).max(2000), includeContact: z.boolean(), eventId: z.string().regex(/^[0-9a-f]{32}$/).optional(), page: z.string().max(500), appVersion: z.string().max(40), app: z.enum(["app", "portal"]) })`
- `buildFeedbackEnvelope(input: { message: string; contact?: { name: string; email: string }; eventId?: string; page: string; app: "app" | "portal"; appVersion: string; userId: string; dsn: string; environment; release }): Uint8Array` — one `feedback` item (`contexts.feedback` with `message`, `url` (the page path), `source: "padvinder"`, `associated_event_id`, and `name` + `contact_email` only with `contact`), `user: { id }`, `tags: { service: app, app_version }`, environment, release, a fresh `event_id`, `timestamp`; the message already scrubbed by the caller.
- `useReportProblem()` in `@padvinder/api-client`: mutation over the generated `POST /api/problem-reports`.

- [ ] **Step 1: Write the failing tests.** `expectStatuses(cast, { every logged-in member: 204, noCookie: 401 }, send)` with Sentry off; with the fake server: `includeContact: true` sends the profile's name and address in `contexts.feedback`, `false` sends neither (raw bytes searched for the cast member's address); a body with an extra `email` or `name` field → 400; a message "mail me at noor@example.test" arrives as "mail me at [email]"; `eventId` arrives as `associated_event_id`; fake Sentry answering 500 or a closed port → 502 `report_not_sent`; the 11th report within an hour by one account → 429 `too_many_reports` (another account still 204); Sentry off → 204 and one `info` log line with the message length, not its text. Messages test: both codes have Dutch texts.
- [ ] **Step 2: Run them to verify they fail.** **Step 3: Implement** (rate limit in memory per process, keyed by user ID, sliding hour). **Step 4: Run** `pnpm vitest run --project api --project monitoring --project ui --project api-client` and `pnpm check:generated`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add problem reports: Sentry user feedback built on the server, contact only by opt-in"`

### Task 4: The browser SDK and the Vite source maps

**Files:**

- Create: `packages/ui/src/monitoring/` (`browser-monitoring.ts` + test): `startBrowserMonitoring`, `setBrowserMonitoringUser`, `lastErrorEventId`; `packages/ui` gets `@sentry/react` `11.18.0` as a dependency
- Modify: `packages/logging/package.json` (an export `./scrub` → `src/scrub.ts`, so the browser can use `scrub` without pino); `apps/mobile/src/main.tsx`, `apps/portal/src/main.tsx` (start monitoring after the forwarding check, wrap `createBrowserRouter` with `Sentry.wrapCreateBrowserRouterV7`); the shared auth gate (`packages/api-client/src/auth-gate.ts` or where `me` settles) calls `setBrowserMonitoringUser`; `apps/mobile` and `apps/portal` `package.json` (`@sentry/react` `11.18.0`) and `vite.config.ts` (`build.sourcemap: "hidden"`; a `vite:preloadError` listener that reloads once)
- Modify: `scripts/build-release.sh` (inject debug IDs into `release/mobile` and `release/portal`, move their `.map` files to `release/sourcemaps/{mobile,portal}`, fail if a served directory holds a `.map` or a `sourceMappingURL`)

**Interfaces:**

- `startBrowserMonitoring(options: { app: "app" | "portal"; appVersion: string; router?: unknown }): boolean` — does nothing unless `import.meta.env.PROD` (pass `enabled` explicitly in tests); `Sentry.init` with the placeholder DSN, `tunnel: "/api/sentry-tunnel"`, the constraints' `dataCollection`, `browserTracingIntegration` via `reactRouterV7BrowserTracingIntegration`, `tracePropagationTargets: [/^\/api\//]`, `initialScope.tags = { service: app, app_version: appVersion }`, `beforeSend` (the 10-per-page-load cap, then `scrub` on every string via a small shared walker, and drop `request.headers`), `beforeBreadcrumb` (scrub; for `ui.click`/`ui.input` keep only the element path without attribute values or text), `ignoreErrors` for network failures (`Failed to fetch`, `Load failed`, `NetworkError when attempting to fetch resource`). No replay, no feedback integration.
- `setBrowserMonitoringUser(id: string | null): void`; `lastErrorEventId(): string | undefined` (for the crash screen).

- [ ] **Step 1: Write the failing tests** (Vitest jsdom, with `enabled: true` and a test transport): the 11th error of a page load is dropped; an error message with an address arrives scrubbed; a click on `<button aria-label="Anne de Vries">Anne de Vries</button>` yields a `ui.click` breadcrumb without "Anne"; `setBrowserMonitoringUser("u1")` gives `user: { id: "u1" }` only; `null` clears it; a `TypeError("Failed to fetch")` sends nothing. Release: after `pnpm release:build --allow-dirty`, `release/mobile` and `release/portal` hold no `.map` and no `sourceMappingURL`, `release/sourcemaps/{mobile,portal}` hold the maps, and every served `.js` that has a map has `_sentryDebugIds`.
- [ ] **Step 2: Run them to verify they fail.** **Step 3: Implement.** **Step 4: Run** `pnpm vitest run --project ui`, `pnpm build`, `pnpm release:build --allow-dirty`, `pnpm release:image && pnpm release:smoke`, and `pnpm test:e2e` (the PWA and both apps still work; Sentry is off under the dev servers). Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Send browser errors, traces and release health through the tunnel; hidden source maps with debug IDs"`

### Task 5: Crash screens and the problem report form

**Files:**

- Create in `packages/ui/src/components/problem-report/`: `crash-screen.tsx`, `problem-report-form.tsx`, their `.stories.tsx` and `.test.tsx`; export from `packages/ui/src/index.ts`
- Create: `apps/mobile/src/screens/more/report-problem-screen.tsx` (+ test); route `more/report-problem`; a "Meld een probleem" item in `MoreMenu` for everyone
- Modify: `apps/mobile/src/router.tsx` and `apps/portal/src/router.tsx` (an `errorElement` with the crash screen on the top route; a root `Sentry.ErrorBoundary` around the router with the same fallback); `apps/portal/src/layout/portal-layout.tsx` (a "Meld een probleem" button at the bottom of the navigation opening the form in a `Modal`); a dev-only route in each app that throws while rendering (`import.meta.env.DEV`), for the end-to-end test
- Create: `e2e/problem-reports.spec.ts` and `e2e/portal-problem-reports.spec.ts`
- Modify: `AGENTS.md` glossary (`Meld een probleem` | `problemReport` | A message a logged-in user sends to the makers of PadVinder, optionally with their name and address)

**Interfaces:**

- `ProblemReportForm({ name, email, onSubmit, errorText }: { name: string; email: string; onSubmit: (input: { message: string; includeContact: boolean }) => Promise<void>; errorText?: string })` — the copy and layout of the spec's sketch: title "Meld een probleem"; intro "Werkt er iets niet? Schrijf op wat je deed en wat er misging. Dit gaat naar de makers van PadVinder. Wil je een antwoord? Stuur dan je naam en e-mailadres mee."; field label "Wat ging er mis?"; checkbox "Stuur mijn naam en e-mailadres mee, zodat we je kunnen mailen" (unchecked on every open) with the name and address below it; button "Verstuur", disabled while the message is empty or sending; large touch targets.
- `CrashScreen({ variant, onReload, onReport })` — title "Er ging iets mis"; app text "De app liep vast. Laad de app opnieuw. Gaat het weer mis? Vertel ons wat je deed."; portal text "De pagina liep vast. Laad de pagina opnieuw. Gaat het weer mis? Vertel ons wat je deed."; buttons "Laad opnieuw" and, only when `onReport` is given, "Vertel wat er gebeurde".
- On success: "Bedankt, je melding is verstuurd." (`showToast` in the portal; in the app a toast or the same sentence on the screen, then back to Meer). On failure: the text from `apiErrorMessage(apiErrorCode(error))`, the message kept.

- [ ] **Step 1: Write the failing tests.** Component tests: the checkbox starts unchecked and shows the name and address; the button is disabled for an empty message and while sending; `onSubmit` gets `includeContact` as ticked; a rejected submit keeps the text and shows the error; the crash screen hides "Vertel wat er gebeurde" without `onReport`. Stories: the form empty, filled, checkbox on, sending, failed (phone viewport); the crash screen app and portal variants, with and without the report button; the portal form in a modal (`visualViewport` 1024×768). Playwright: in the app, Meer → "Meld een probleem" → type → "Verstuur" → "Bedankt, je melding is verstuurd."; in the portal, the button → modal → same; the dev-only crash route shows "Er ging iets mis" with "Vertel wat er gebeurde" when logged in, and only "Laad opnieuw" before login.
- [ ] **Step 2: Run them to verify they fail.** **Step 3: Implement.** The crash screen's report button opens the form inline (in the crash screen itself, since the router may be broken), passing `lastErrorEventId()` as `eventId`.
- [ ] **Step 4: Run** `pnpm vitest run --project ui --project mobile --project portal`, `pnpm test:e2e`, then `pnpm screenshots:update` (Docker) and commit the new references. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the crash screens and Meld een probleem to the app and the portal"`

### Task 6: Documentation and the full check

**Files:** `AGENTS.md`, `infra/alwaysdata/README.md`

- [ ] **Step 1: AGENTS.md** "Monitoring": the browser half (placeholder DSN, the tunnel and what it does to each envelope, the 10-per-page-load cap, the breadcrumb rule, off under the dev servers, `setBrowserMonitoringUser` in the auth gate); "Problem reports" (endpoint, contract, opt-in contact from the profile, 204/502/429, the forms and crash screens, the dev-only crash route); "Release": `release/sourcemaps/{mobile,portal}`; "Current state": pull request 3 of 3, logging and monitoring done.
- [ ] **Step 2: README** "Verification": the browser rows of the spec (an error thrown in the app on a phone arrives through the tunnel with a readable stack trace and Alwaysdata's address, not the phone's; a problem report from the app and from the portal arrives with and without name and address, and one on production mails the maintainer), each `OPEN`.
- [ ] **Step 3: `pnpm format` on the docs, then `pnpm check`.** Expected: exit 0. **Step 4: Commit.** `git commit -m "Document the browser side of monitoring and problem reports"`
