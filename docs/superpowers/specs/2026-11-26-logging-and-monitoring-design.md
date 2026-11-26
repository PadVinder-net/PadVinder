# Logging and monitoring

Date: 26 November 2026. Status: approved by the maintainer on 26 November 2026 ("Go ahead and implement"), who reviews it again with the build.

Changed on 26 November 2026: two Sentry projects instead of one (see "Sentry: the organization"). The browser's events and the problem reports go to `padvinder-browser`, the API's and the worker's to `padvinder-server`.

This design replaces issues #3 ("Logging-boilerplate voor API en worker") and #5 ("Better Stack-integratie: uptime, heartbeat en foutmeldingen"). Both were written on 19 November 2026, before the skeleton, the deploy and slice 1 existed; "What the issues asked, and what changed" says what this design keeps, changes and drops of each.

## Intent

PadVinder goes live for the 2027 season, whose drain checks are a baseline measurement that cannot be redone. When something breaks on a migration evening, the maintainer must hear it before a coordinator calls, and must be able to see what broke: which request, which queries, which volunteer (by account ID), which release. Volunteers must be able to say "this does not work" from the app without knowing whom to mail.

Today the API logs JSON through Fastify's pino logger, the worker writes plain text through `console`, both into Alwaysdata's service logs, and nobody is told when `/api/health` fails. Errors on phones are invisible.

So this design does two things:

1. **Logging (#3):** one logger for the API and the worker, with fixed fields, a scrubbing rule for errors, and a short guide in AGENTS.md on what to log at which level.
2. **Monitoring (#5):** Sentry, in its EU region, receives errors, traces and the volunteers' problem reports from the API, the worker, the mobile app and the portal, and checks `/api/health` from outside. The maintainer gets a mail for a new problem and for an outage.

## Goals

- An error in the API, the worker, the app or the portal becomes a Sentry issue, with the release, the environment, the account ID, and the trace of the request or job it happened in: its database queries and outgoing calls, in order, with their timing.
- An outage of production (the API, the database or the worker) mails the maintainer within a few minutes.
- A logged-in volunteer or coordinator reports a problem from the app or the portal, optionally with their name and email address so they can get an answer. After a crash, the report is linked to the error.
- Stack traces in Sentry point at the source, for the browser bundles and the server bundles alike.
- One logger for the API and the worker: JSON on stdout, readable in development, the same fields, the same scrubbing.
- Nothing personal reaches Sentry or the logs except the account ID and what a person chooses to send in a problem report.

## Non-goals

- Shipping logs anywhere. They stay in Alwaysdata's service logs. Sentry's Logs product is not used.
- Session Replay, profiling, Sentry's AI features (Seer), the cron monitor, a status page.
- Alerts to a second person, and a rota for who responds during the season. The plan's open point "Draaiboek bij storingen" stays open (see "Open questions").
- A Better Stack account, and a worker heartbeat sent to an outside service (see "Approaches").
- Problem reports from someone who is not logged in.
- An answer to a problem report inside the app. A reply, when there is one, goes by mail from outside PadVinder.

## Anti-goals

What would make this a failure even if it works:

- An email address, a name, a phone number, an IP address, a cookie, a login code, a request body or a coordinate reaching Sentry or the logs, other than the name and address a person opts to send with a problem report.
- A phone talking to `sentry.io` directly, so that Sentry sees a volunteer's IP address.
- Sentry being slow or down making a request slower, failing a request, or failing a deploy.
- One bug on one migration evening using up the month's error quota, so that the next problem is invisible.
- An alert that nobody receives: the uptime monitor or the alert rules exist but mail nobody.

## Constraints

All of AGENTS.md applies. The ones that shape this work most:

- **Running costs stay very low; as little third-party SaaS as possible, unless it is free; data stays in the EU.** Sentry's free Developer plan costs nothing, and an organization made in the EU region stores events, traces, releases, source maps and backups in Frankfurt. Accounts, organization settings, audit logs, DSN keys and cron check-ins are always stored in the US, and Sentry has no EU legal entity ([data storage location](https://docs.sentry.io/organization/data-storage-location/), [sub-processors](https://sentry.io/legal/subprocessors/)). None of those US-stored items holds volunteers' data. Sentry becomes a processor: issue #1 has a checkbox for its DPA and the privacy statement since 26 November 2026.
- **No vendor lock-in.** The Sentry SDK's protocol is also accepted by GlitchTip (self-hostable) and Better Stack, so moving means changing the DSN, plus setting up alerts there.
- **Who sees names; collect minimal personal data.** Sentry gets the account ID (a UUIDv7), never the name, address, phone number or IP address, except the opt-in in a problem report.
- **The repository is public; the CI workflow uses no secrets.** Source maps are uploaded by the Deploy workflow, which already holds secrets per GitHub environment, not by the pull request CI.
- **One release for both environments.** The tarball is built once and deployed to staging and production, so nothing environment-specific (a DSN, an environment name) can be built into the browser bundles.
- **1 GB of memory for four processes.** Already an open check on Alwaysdata; Sentry in the API and the worker adds to it.
- **Everything a user reads is Dutch,** with "je", short sentences, sentence case.

### The free plan's limits

From [sentry.io/pricing](https://sentry.io/pricing/) on 26 November 2026: one user, 5,000 errors, 5 million spans, 1 uptime monitor, 1 cron monitor, 30 days of history, alerts by email only, to members of the organization. Sentry's terms limit "no-charge" use to "the period designated by Sentry (or if not designated, 30 days)" (§17 of [the terms](https://sentry.io/terms/)); whether that covers the Developer plan is unclear. Sentry's [sponsorship for open source and non-profits](https://sentry.io/for/good/) gives far higher limits and more seats, at Sentry's discretion; whether to apply is the maintainer's choice. This design fits the free plan.

## What the issues asked, and what changed

### #3 Logging-boilerplate

| Asked                                                                          | Now                                                                                                                                                                                                                                                                      | In this design                                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pino in the API and the worker, through a shared package                       | The API uses Fastify's pino (10.4.0); the worker has its own `console` logger (`apps/worker/src/logger.ts`)                                                                                                                                                              | Kept: `packages/logging`                                                                                                            |
| JSON to stdout; `pino-pretty` in development                                   | The API's log is JSON; the worker's is plain text                                                                                                                                                                                                                        | Kept                                                                                                                                |
| Fields `level`, `time`, `service`, `env`, `version`, `reqId`                   | The API has `level`, `time`, `reqId`                                                                                                                                                                                                                                     | Changed: `service` on every line; environment and commit on the start line (the version of the API is the commit, not CalVer)       |
| The pg-boss job name and ID                                                    | Not logged                                                                                                                                                                                                                                                               | Kept, also as Sentry tags                                                                                                           |
| Redact cookies, `authorization`, login codes, email addresses, exact locations | Headers are never logged (Fastify's request serializer leaves them out); codes never logged; Better Auth and mail logs scrubbed by hand. Gap: `{ err }` logs every field of an error, and a PostgreSQL error's `detail` can hold the duplicate value, such as an address | Changed: an allowlist serializer for errors and one scrub function for the log and Sentry, with tests, instead of redaction by path |
| `LOG_LEVEL`, default `info`                                                    | Exists in both                                                                                                                                                                                                                                                           | Done                                                                                                                                |
| Log `uncaughtException` and `unhandledRejection` before the process stops      | Not handled; Node prints an unscrubbed stack to stderr                                                                                                                                                                                                                   | Kept, and sent to Sentry                                                                                                            |
| A short guide in AGENTS.md                                                     | Missing                                                                                                                                                                                                                                                                  | Kept                                                                                                                                |
| (later) Logs to Better Stack                                                   |                                                                                                                                                                                                                                                                          | Dropped                                                                                                                             |
| (new)                                                                          | Every `/api/health` request is logged at `info`, against what #4 asked                                                                                                                                                                                                   | Added: health requests log below `info`                                                                                             |

### #5 Better Stack

| Asked                                                                  | In this design                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A Better Stack account in the working group's name                     | Changed: a Sentry organization, made by the maintainer, ideally on the shared admin address of the plan's open point on account ownership                                                                                                                                                                                                                                                  |
| An uptime monitor on `/health` of production, maybe staging            | Kept, as Sentry's one free uptime monitor, on production's `/api/health`, which already answers 503 when the database is unreachable or the worker's heartbeat is older than 3 minutes. Not on staging: it can be switched off, and the free plan has one monitor                                                                                                                          |
| A worker heartbeat to a heartbeat URL                                  | Dropped: the check above covers the worker, with no outgoing HTTP from the worker and no secret URL                                                                                                                                                                                                                                                                                        |
| Alerts to one or two people; who responds in the season                | Changed: mail to the one member of the free plan. Who responds stays open                                                                                                                                                                                                                                                                                                                  |
| Errors from API, worker and PWA through the Sentry SDK to Better Stack | Changed: to Sentry itself, in its EU region. Better Stack's free plan is labelled "Free for personal projects", its DPA allows processing in the US, and storing in Germany is for paid plans ([pricing](https://betterstack.com/uptime/pricing), [DPA](https://betterstack.com/dpa), [changelog](https://betterstack.com/community/blog/changelog-9-advanced-data-options-for-everyone/)) |
| No personal data from the browser                                      | Kept, and tightened: the phone never talks to Sentry (see "The tunnel")                                                                                                                                                                                                                                                                                                                    |
| Logs to Better Stack                                                   | Dropped                                                                                                                                                                                                                                                                                                                                                                                    |
| A status page, if free                                                 | Dropped for now                                                                                                                                                                                                                                                                                                                                                                            |
| URLs and tokens as GitHub secrets, set on the services by provisioning | Kept: `SENTRY_DSN` and `SENTRY_BROWSER_DSN` through provisioning; `SENTRY_AUTH_TOKEN` for the Deploy workflow                                                                                                                                                                                                                                                                              |

## Approaches

Decided with the maintainer on 26 November 2026.

**Where errors and logs go.** Considered:

1. _Only Alwaysdata:_ logs in the service logs, browser errors sent to our own API and logged, an outside uptime check only. Keeps all data with us, but gives no grouping of errors, no mail per new error and no traces.
2. _A hosted error tracker in the EU, through the Sentry SDK_ (chosen: Sentry, EU region). Issues, traces, release health and user feedback are what the maintainer wants, and Sentry does them well. Logs stay on Alwaysdata.
3. _Self-hosted GlitchTip on Alwaysdata._ Data stays with us, but it needs 256–512 MB next to four processes in 1 GB, likely forcing Plus Medium (about € 255 a year in total).

Better Stack was dropped for the reasons in the table above.

**How outages are noticed.** Considered:

1. _Sentry's free uptime monitor on `/api/health`_ (chosen). One service, one account; the endpoint already covers the database and the worker.
2. _A second service_ (Better Stack, UptimeRobot). Another account and processor for the same check.
3. _A scheduled GitHub Actions run._ At most every 5 minutes, may be delayed or dropped, and is switched off after 60 days without activity in a public repository ([GitHub docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).

**How server errors reach Sentry.** Considered:

1. _Sentry's Node SDK with its integrations and tracing_ (chosen). Database queries and outgoing HTTP calls are recorded as spans of the request's or job's trace, so an error shows what led to it; richer integrations later are configuration. It needs Sentry's instrumentation loaded before `pg` (see "Server").
2. _Only through the logger:_ every `error` line becomes an issue, nothing else. Simpler and lighter, but no traces, and every later integration is our own work.

**What the problem report is for.** Considered:

1. _Bug reports to the maintainer, with an optional, opt-in name and address_ (chosen). No screenshot: it can show other members' names and, later, the map with drains, which are not public.
2. _A support channel_ with a required address and an answer in the app. Rejected: an answer belongs with the coordinator.

The opt-in is one unchecked checkbox that shows the name and address from the profile (chosen), not two text fields to type in: one tap on a phone outdoors, and no mistyped address.

**Whose form.** _Our own form in both apps, sent through our API_ (chosen), not Sentry's feedback widget: it looks like the rest of the app with large targets, has no Sentry branding and no extra bundle, and the API adds the account ID and the opt-in contact details from the session, so a report cannot claim to be from someone else.

**How the browser reaches Sentry.** Considered:

1. _Our own tunnel endpoint on the API_ (chosen), which forwards without the phone's headers and adds the server's DSN. Sentry sees Alwaysdata's address, ad blockers do not block it, and the DSN stays on the server.
2. _Directly to `sentry.io`._ Sentry sees every volunteer's IP address.
3. _Sentry's managed tunnel_ (`tunnel: true` with `serveTunnelIntegration`, since 11.13.0). Rejected: it deliberately passes the visitor's IP address on to Sentry ([tunneling docs](https://docs.sentry.io/platforms/javascript/configuration/tunneling/); `X-Sentry-Forwarded-For` in `@sentry/core` 11.18.0).

**How source maps reach Sentry.** Considered:

1. _The release build makes them, the Deploy workflow uploads them_ (chosen). The pull request CI keeps using no secrets.
2. _Upload during the build._ Needs a secret in the CI workflow.
3. _Serve them publicly and let Sentry fetch them._ No token, but Sentry calls hosting "not always advisable" and may not reach the server ([docs](https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/hosting-publicly/)).

## Design

### The logger

A new package `packages/logging` holds the one logger for the API and the worker:

- **`createLogger({ service, level })`** returns a pino logger writing JSON to stdout, with `service` (`api` or `worker`) on every line. The API hands it to Fastify (`loggerInstance`), so request lines and route logs share it; the notification hub uses it too, instead of today's spare Fastify instance (`start-api.ts`). The worker's `apps/worker/src/logger.ts` goes, and its calls change to pino's form, `log.error({ err }, "Mail dropped after the last try")`.
- **The start line** of each process holds `environment` and `commit`.
- **Errors are serialized through an allowlist:** type, message, stack, `code` (the SQLSTATE of a PostgreSQL error), `constraint`, `table`, `column` and `cause` (the same way, recursively). Everything else on an error object, such as `detail`, `where` or the parameters, is left out. The message and the stack go through the scrub function.
- **The scrub function** (`scrub`, in the same package) replaces anything that looks like an email address with `[email]`. The logger and every Sentry hook (see "Server" and "Browser") use it, so there is one rule. `forwardLog` for Better Auth keeps its own reduction and uses this function.
- **Request lines** keep method, URL, status code, response time and `reqId`; they leave out the client's address and port. (Without `trustProxy` that address is Alwaysdata's proxy today, but a later `trustProxy` would make it the volunteer's.) Headers stay out, as now.
- **`/api/health` is logged below `info`,** so the uptime monitor (once a minute) does not fill the log. Its warnings ("could not reach the database") stay.
- **pg-boss jobs** log through a child logger with `job: { name, id }`.
- **A crash** (`uncaughtException`, `unhandledRejection`) is logged at `error`, reported to Sentry and flushed (with a time limit) before the process exits with code 1, so the supervisor restarts it.
- **In development** the output is piped through `pino-pretty`; `LOG_LEVEL` stays as it is (`debug`, `info`, `warn`, `error`; default `info`).

#### What to log at which level (for AGENTS.md)

- **`error`:** a person must look at it. It becomes a Sentry issue. Examples: an unexpected error behind a 500, a mail dropped after its last try, a pool error, a job that failed.
- **`warn`:** unusual but handled, often with a retry. Examples: a mail that will be tried again, the notification listener reconnecting, the health check not reaching the database.
- **`info`:** the life of the process and one line per request. Start, stop, request lines.
- **`debug`:** detail for development.
- **Never in a log line or an error message:** a name, an email address, a phone number, an IP address, a cookie or header, a login code, a request body, or a coordinate. IDs are fine. When a value would help, log its kind or its length.

### Sentry: the organization

The maintainer makes one Sentry organization **in the EU region** (Frankfurt; this cannot be changed later) and two projects. `padvinder-server` holds the API and the worker, and the uptime monitor. `padvinder-browser` holds the app and the portal, and the problem reports (they are about what people see). Events carry the tag `service` (`api`, `worker`, `app`, `portal`) and the environment (`production`, `staging`).

Why two: the inbound filters for browser extensions, legacy browsers and web crawlers only make sense for browser events; the alert rules can be tuned per side; and the browser project has its own rate limit on its DSN key, so a flood of errors through the public tunnel cannot crowd out an outage of the server. Traces still join across the two projects, because they share the trace ID. The API and the worker stay in one project: they share a platform, the same packages and one release, and the tag `service` tells them apart.

Set by hand, and written down in `infra/alwaysdata/README.md` as a checklist (not scripted, like the mailbox):

- **Security & Privacy:** do not store IP addresses; the default scrubbers on; an Advanced Data Scrubbing rule that removes email addresses from all fields, as a second net behind our own scrubbing, if the free plan has it.
- **Show Generative AI Features** off.
- **Inbound filters:** browser extensions, legacy browsers and web crawlers on the browser project; localhost on both. Filtered events do not count against the quota.
- **Spike protection** on in both projects, with its notification.
- **A rate limit on the DSN key** (Client Keys) of the browser project, for example 300 events an hour, if the free plan has it; the server project's key gets a higher one or none. It caps the total, which spike protection does not: a steady stream of errors from many phones over an evening may never count as a spike.
- **Alert rules,** mailing the member, for the environment `production` only, in each project: a new issue, a resolved issue that comes back and an issue that escalates; on the server project also the uptime monitor's issue, and on the browser project every new problem report (Sentry files user feedback as issues of the category Feedback). Staging's issues are recorded but mail nobody. If the free plan cannot mail on feedback, the maintainer reads Sentry's feedback list instead and this design is revisited; PadVinder does not mail reports itself.
- **The uptime monitor,** on the server project: `https://padvinder.net/api/health` every minute. Sentry opens an issue after three failures in a row (a status outside 200–299, a timeout or a DNS failure), so an outage mails within about four minutes.
- **The weekly report** mail on.
- **The GitHub integration** on both projects, for links from stack traces to the code and for suspect commits, if the free plan has it.
- An **organization auth token** for uploading source maps.

### Configuration

- **`PADVINDER_ENVIRONMENT`:** `production`, `staging` or `development` (the default). Provisioning writes it to the env file. Used for the Sentry environment and the start line.
- **`SENTRY_DSN`:** a secret in both GitHub environments, written to the env file by provisioning like `SMTP_PASSWORD`, read by the API and the worker. Without it Sentry is off on the server: locally, in tests, in CI and in the container smoke test. Provisioning requires it, like every other secret of the env file.
- **`SENTRY_BROWSER_DSN`:** the browser project's DSN, a secret in both GitHub environments, written to the env file by provisioning and read by the API only (the tunnel and the problem reports use it; the worker checks it at start-up through `readMonitoringSettings` but does not use it). Without it the tunnel answers 204 and drops the envelope, and a problem report is only logged. Provisioning requires it too. The server's Sentry depends only on `SENTRY_DSN`.
- **`SENTRY_AUTH_TOKEN`:** a secret in both GitHub environments, used only by the Deploy workflow's upload step.
- **The release** is the git commit (`GIT_COMMIT` on the server; the build's commit in the browser bundles). The app's CalVer version and build number go along as tags.

### Server

The API and the worker use `@sentry/node` (11.18.0 on 26 November 2026). Upgrades are reviewed for what the SDK collects: v11 changed the defaults.

- **Loaded before `pg`.** In v11 the Postgres integration hooks into `pg` when the module is loaded, through Sentry's runtime hook (`@sentry/server-runtime-injection`, which must stay external to the bundle; it is, since the bundles keep `node_modules` external). So Sentry is initialized in a small module that runs before anything imports `pg`. Preferred: `main.js` imports that module first and the rest of the program by dynamic import, so the service command on Alwaysdata does not change. If the hook only works through `node --import`, the service command, the container image and the dev scripts get `--import`, and "Rolling out" below gains a step: deploy the release first, then run Provision, which changes the command. The builder proves either way with a test that a query appears as a span.
- **What is recorded:** errors (5xx of the API, `error` log lines through Sentry's pino integration, crashes), each with the trace of its request or job; spans for database queries and outgoing HTTP calls; one span by hand around each mail send (SMTP is not HTTP, so nothing records it otherwise). Each error becomes one issue: the builder makes sure an error that is both thrown into Fastify and logged at `error` is not reported twice.
- **Tracing** samples every request and every job, except `/api/health`, `/api/events`, the static files of the apps (everything outside `/api/`), and the worker's heartbeat job. If the monthly span count nears the free 5 million, the rate is lowered. A rough count for one migration evening (50 volunteers, 2 hours) is 60,000 spans.
- **The user** is `{ id }` of `request.actor`, set when the actor is loaded. Nothing else of the user.
- **Data collection is set explicitly.** Since v11, leaving `dataCollection` unset collects user info with the IP address, cookies, all request and response bodies, and database query data by default (v11 migration guide). All of those are off. Request headers are not sent. Query text stays: Drizzle sends SQL with `$1` placeholders, so it holds no values.
- **`beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`** run every string through `scrub`. `serverName` is the service name, not the host's name.
- **pg-boss jobs** carry the tags `job.name` and `job.id`, and run inside a span, so a failed job's issue shows its queries.
- **Sentry never blocks the app.** Events are sent in the background; an unreachable Sentry costs a dropped event, not a slower request. On shutdown the API and the worker flush with a short time limit (about 2 seconds), within the restart Alwaysdata does now.

### The tunnel

`POST /api/sentry-tunnel` receives the browser SDK's envelopes and forwards them to Sentry.

- **No login needed,** so that errors on the login screen arrive too. The Origin check that guards every state-changing request applies.
- **It forwards to the browser project's DSN only.** It reads the envelope header, ignores the DSN the browser sent, and posts the envelope to the ingest address of `SENTRY_BROWSER_DSN` (`https://o<id>.ingest.de.sentry.io/api/<project>/envelope/`). So the bundles need no DSN, and nobody can use our endpoint to send to another project.
- **None of the phone's headers go along:** no `X-Forwarded-For`, no cookie, no user agent header. Sentry sees the API's address.
- **Limits:** a maximum body size, and a rate limit per IP address in the style of the login limits (in memory or in `rate_limits`; the builder chooses). A refused envelope answers 429 or 413 and the SDK drops it. The per-IP limit caps one sender, not the total; the total is capped in the browser and by the DSN key's rate limit (see "Browser" and "Sentry: the organization"). Someone deliberately spending the quota through the tunnel is an accepted risk.
- **Without `SENTRY_BROWSER_DSN`** it answers 204 and drops the envelope.
- **The environment:** the browser bundles cannot know whether they run on staging or production (one release for both). The builder chooses between the tunnel setting `environment` on each item it forwards, and the browser reading it at start from a public field added to `/api/version`.

### Browser

The mobile app and the portal use `@sentry/react` (11.18.0), initialized in `main.tsx` after the forwarding between app and portal and before the first render.

- **Sent through the tunnel,** with the same `dataCollection` settings as the server, and the same `scrub` in `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`.
- **The user** is `{ id }` from `/api/me` while someone is logged in, and cleared on logging out.
- **Tracing** of page loads, navigations (React Router's integration) and API calls, with trace headers sent only to our own `/api/`, so a tap and the API request it causes are one trace.
- **Breadcrumbs:** the defaults (taps, navigation, API calls, console), scrubbed. A tap's breadcrumb must not carry a person's name from the element's text or attributes; a test checks a tap on a member in the members list.
- **Release health** (crash-free sessions and users per release) stays on, as by default.
- **At most 10 error events per page load,** counted in `beforeSend`; more are dropped. One phone in an error loop then costs 10 events, not hundreds. Sessions, traces and problem reports do not count.
- **Not reported as issues:** failed calls when the phone has no connection, and 4xx answers; a 5xx is reported by the API itself. A failed chunk load after a deploy reloads the page instead (the builder checks what the PWA does now).
- **Not used:** Session Replay and Sentry's feedback widget.
- **Locally** (the Vite dev servers) Sentry is off.

### Crash screens

Each app gets an error screen for a crash, as the router's error element and around the whole app.

App:

```
┌──────────────────────────────┐
│ Er ging iets mis             │
│                              │
│ De app liep vast. Laad de    │
│ app opnieuw. Gaat het weer   │
│ mis? Vertel ons wat je deed. │
│                              │
│ [ Laad opnieuw ]             │
│ [ Vertel wat er gebeurde ]   │
└──────────────────────────────┘
```

The portal says "De pagina liep vast. Laad de pagina opnieuw. Gaat het weer mis? Vertel ons wat je deed." with the same buttons. "Vertel wat er gebeurde" opens the problem report form, linked to the crash's Sentry event ID, and shows only when someone is logged in.

### Problem reports

A problem report (`problemReport`, glossary term "Meld een probleem") is a message a logged-in user sends to the makers of PadVinder.

**Where:** in the app, Meer, "Meld een probleem" (`/more/report-problem`); in the portal, "Meld een probleem" at the bottom of the navigation, for everyone who sees the portal, opening the form in a `Modal`; and from the crash screens.

**The form:**

```
┌──────────────────────────────┐
│ Meld een probleem            │
│                              │
│ Werkt er iets niet? Schrijf  │
│ op wat je deed en wat er     │
│ misging. Dit gaat naar de    │
│ makers van PadVinder. Wil je │
│ een antwoord? Stuur dan je   │
│ naam en e-mailadres mee.     │
│ ┌──────────────────────────┐ │
│ │ Wat ging er mis?         │ │
│ └──────────────────────────┘ │
│ [ ] Stuur mijn naam en       │
│     e-mailadres mee, zodat   │
│     we je kunnen mailen      │
│     Anne de Vries            │
│     anne@example.test        │
│ [ Verstuur ]                 │
└──────────────────────────────┘
```

- The checkbox is unchecked every time the form opens, and shows the name and address from the profile.
- "Verstuur" is disabled while the message is empty or while sending. On success: "Bedankt, je melding is verstuurd.", and the form closes. On failure the message stays and the text comes from `apiErrorMessage`.
- No screenshot, no attachment.

**The endpoint:** `POST /api/problem-reports`, behind `requireActor` (401 without a login; every logged-in user may send one, applicants included). The body is strict: `message` (trimmed, 1 to 2,000 characters), `includeContact` (boolean), optional `eventId` (the crash's Sentry event ID), `page` (the path the user was on) and `appVersion`. The API sends it to the browser project of Sentry as user feedback (`captureFeedback`), with the user `{ id }`, the tag `service` (`app` or `portal`), the environment and the release, and, only when `includeContact` is true, the name and address **from the actor's profile**, never from the body. The message goes through `scrub` (the form tells people to use the checkbox for their address); the opted-in contact address is the one exception to scrubbing. Answers: 204 when Sentry accepted it, or when `SENTRY_BROWSER_DSN` is not set (then the API logs at `info` that a report arrived, with its length, not its text); 502 `report_not_sent` when Sentry could not be reached, so the user can try again. A rate limit per account (for example 10 an hour) answers 429 `too_many_reports`. It is not a write from the field, so it has no client-generated ID; the disabled button prevents a double send.

### Source maps

- **The release build** (`scripts/build-release.sh`) makes source maps for the Vite builds and the tsdown bundles, injects Sentry's debug IDs into the bundles at build time, before the PWA's precache manifest is made, and moves the maps to `release/sourcemaps/`. The served directories hold no maps and no `sourceMappingURL`. The build needs no token.
- **The Deploy workflow** uploads `release/sourcemaps/` with `sentry-cli` (pinned) and `SENTRY_AUTH_TOKEN`: `api` and `worker` to `padvinder-server`, `mobile` and `portal` to `padvinder-browser`, in the staging and in the production job, before the switch. Uploading the same maps twice is harmless. A failed upload is a warning in the run, never a failed deploy. Without the token (a local deploy) the step is skipped.

### Rolling out

The maintainer, once, in this order:

1. If you already made the project `padvinder`: rename its slug to `padvinder-server` (Settings, Projects, padvinder, General). Its DSN stays the same (a DSN names the project by its number, not its slug) and is `SENTRY_DSN`. Raise or remove its key's rate limit if you set the browser's 300 an hour on it, and remove browser-only inbound filters if you like. Then make `padvinder-browser` and set `SENTRY_BROWSER_DSN`.
2. Make the Sentry organization in the EU region (if it does not exist), the projects `padvinder-server` and `padvinder-browser` and an organization auth token; do the checklist in "Sentry: the organization".
3. Set `SENTRY_DSN`, `SENTRY_BROWSER_DSN` and `SENTRY_AUTH_TOKEN` in both GitHub environments.
4. Merge. Then run Provision with `apply` for staging and for production (it writes `SENTRY_DSN`, `SENTRY_BROWSER_DSN` and `PADVINDER_ENVIRONMENT`), and restart the services or deploy again.

A deploy before step 4 works: without `SENTRY_DSN` the API and the worker run with Sentry off, and without `SENTRY_BROWSER_DSN` the tunnel and the problem reports drop what they get.

### Verification on Alwaysdata

New rows for the "Verification" table in `infra/alwaysdata/README.md`:

- An error on staging (a test route, or a deliberate failure the builder provides for platform admins) arrives in Sentry with the commit, the environment, the account ID and the trace with its queries; no IP address, cookie or email address in it.
- An error thrown in the app on a phone arrives through the tunnel, with a readable stack trace, and Sentry shows Alwaysdata's address, not the phone's.
- A problem report from the app and from the portal arrives, once with and once without name and address, and a report on production mails the maintainer.
- Stopping production's worker makes `/api/health` answer 503 and the uptime monitor mail within about four minutes (or the same check on staging with a temporary monitor).
- Memory of the API and the worker with Sentry, in the panel's Processes, next to the existing open check of four processes in 1 GB.

## Tests

As AGENTS.md requires. The parts that need care:

- **Scrubbing:** a PostgreSQL unique violation whose `detail` holds an address is logged without the address and without `detail`; the same error reaches Sentry's test transport without the address. `scrub` has unit tests.
- **The logger:** `service` on every line; a job's lines carry its name and ID; a health request writes no `info` line; request lines have no client address; a crash is logged and reported before the exit.
- **Sentry on the server,** with a test transport: a 500 from a request with a cookie and a body holding an address gives one issue with the user's ID, the release and the environment, and no cookie, header, body, address or IP address; the trace holds the query spans, without values; `/api/health` gives no trace; an `error` line from the worker gives an issue with the job's tags; a `warn` line gives none.
- **The tunnel:** forwards to the browser DSN's ingest address only, whatever DSN the browser sent; sends none of the request's headers on; refuses a body over the limit and a sender over the rate limit; answers 204 without `SENTRY_BROWSER_DSN`; works without a login; tested against a local fake Sentry server.
- **Problem reports:** an `expectStatuses` test with the cast (every logged-in member may send, no cookie gives 401); with `includeContact` the report holds the profile's name and address, without it neither; a body with a name or address field is 400; the message is scrubbed; the rate limit; `eventId` is passed on.
- **The browser:** component tests and stories for the form (empty, filled, checkbox on, sending, failed) and both crash screens; a test that a tap's breadcrumb holds no name; a test that the eleventh error of a page load is dropped; a Playwright test that sends a problem report from the app and one from the portal, and one that makes the crash screen appear.
- **The release:** the served directories hold no maps and no `sourceMappingURL`; `release/sourcemaps/` holds them, with debug IDs matching the bundles; the existing smoke test and end-to-end tests still pass (the service worker included).

## Order of work

Three pull requests, in this order, each with its own plan:

1. **Logging (#3).** `packages/logging`, the worker on pino, the error serializer and `scrub`, the health request level, the crash handlers, `pino-pretty` in development, and the guide in AGENTS.md.
2. **Sentry on the server.** `@sentry/node` in the API and the worker with tracing, `PADVINDER_ENVIRONMENT` and `SENTRY_DSN` in env and provisioning, source maps for the server bundles and the upload in Deploy, the README's checklist, rollout and verification rows, and AGENTS.md (the tech stack table, the environment variables, the release layout).
3. **Sentry in the browser and problem reports.** The tunnel, `@sentry/react` in both apps, the crash screens, `POST /api/problem-reports` with the form in both apps, source maps for the Vite builds, and the glossary entry.

## Left to the builder

- File and module names, the exact allowlist fields beyond those named, and the sample rate's mechanism.
- How Sentry is loaded before `pg` (see "Server"), proven by a test.
- How one error is kept from becoming two issues.
- Where the browser gets its environment (see "The tunnel").
- The tunnel's body limit and rate limit, and the problem reports' rate limit, within the behavior above.
- How debug IDs are injected without breaking the service worker's precache.
- Whether `pino-pretty` runs as a pipe in the dev scripts or as a transport.
- The deliberate failure for the verification on staging, if any.
- Remaining small Dutch texts, in the style of AGENTS.md.

## Related designs

- **Drain register** (`drain-register-design`): drains and their positions are not public, so coordinates must not appear in log lines, error messages or span attributes; drain IDs may. This design's scrubbing covers email addresses only.
- **Stronger login for admins** (`admin-login-design`): no overlap beyond the logger that Better Auth's log goes through.

## Open questions

None that block planning. For the maintainer, before the season:

- **Who responds** to an alert on a migration evening, and how (the plan's "Draaiboek bij storingen"). The free plan mails one person.
- **Whether to apply** for Sentry's sponsorship, for more errors and seats, and how to read §17 of Sentry's terms for the free plan.
