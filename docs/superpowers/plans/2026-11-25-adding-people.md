# Adding People by Email Address Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pull request 3a of "Portal administration": a coordinator or admin adds people to a working group by email address, each added or appointed person gets a mail through a queue in the worker, and a member asks for another working group in the app.

**Architecture:** All mail code moves to a new shared package, `packages/mail`, used by the API and the worker; every mail starts with a greeting built there. The four new mails go through a pg-boss queue: the API inserts a job, holding IDs only, in the transaction that makes the change, and the worker loads the address and names when it sends, one mail at a time. Adding by address is one function in `packages/db` per address, each in its own transaction. The app's Profiel gets part 1's picker for another working group, which the invitation mail points to.

**Tech Stack:** The existing stack. `pg-boss` (12.38.2, as in the worker) becomes a dependency of the API too; `nodemailer` becomes one of the worker too.

**Spec:** `docs/superpowers/specs/2026-11-22-portal-administration-design.md` (read it, the design of part 1 `2026-11-21-accounts-and-access-design.md`, and `AGENTS.md` before starting any task). This plan covers the first half of item 3 under "Order of work". The maintainer decided on 25 November 2026 to build that item as two pull requests: 3a, this plan, and 3b, `2026-11-25-requests-in-the-portal.md`. This half holds adding by address with its form, `packages/mail` with the greeting for all mails, the mail queue in the worker, the new mails, the changed request mail, and asking for another group in the app. The other half holds the requests page with its modal and the forwarding between app and portal.

**Builds on:** the pull request of `2026-11-25-organizations-working-groups-and-roles.md`, merged or as a branch to stack on: work on a branch stacked on its branch when it is not merged yet. Names marked _(from the organizations plan)_ come from that plan, not from code: check the real name before you use it, read the "Deviations" at the end of that plan, and keep the behavior asked here. That plan already built `users.last_login_at`, `hasLoggedIn`, the texts "(nog niet ingelogd)" and "(nog geen naam)", and the setting `MAIL_SUBJECT_PREFIX` (its Task 13); this plan uses them. This plan does not need `2026-11-25-requests-in-the-portal.md` (pull request 3b), and that plan does not need this one. Whichever of the two is built second rebases on the first and resolves the shared files: `apps/portal/src/layout/navigation.ts`, `packages/ui/src/lib/messages.ts`, `packages/ui/src/index.ts`, `packages/api-client/src/administration.ts` and `membership.ts`, and `AGENTS.md`; also `packages/db/src/membership-requests.ts`, `apps/api/src/routes/membership-requests.ts`, `infra/alwaysdata/README.md`, and the generated OpenAPI file and client, which are made again with `pnpm api:generate`, never merged by hand.

**The seam with pull request 3b:** this plan changes the request mail, whose button links to the app's address for the request, and until 3b is merged that address opens the app's own request screen on a laptop too.

**What the deploy needs:** no new secret and no new setting. On Alwaysdata the worker reads the same env file as the API (`padvinder/<env>/.env`), which holds `PUBLIC_ORIGIN`, the SMTP settings and `MAIL_FROM` since login was rolled out. From this pull request on the worker refuses to start without them; a deploy to an environment that lacks them fails its health check (no heartbeat) and rolls back. pg-boss makes the queue by itself when the worker or the API first needs it. Staging's env file also holds `MAIL_SUBJECT_PREFIX` _(from the organizations plan)_ once the maintainer has run Provision for it; the worker reads it from the same file, and starts without it.

## Global Constraints

- AGENTS.md applies in full: English code, Dutch UI copy with "je", English kebab-case URL paths, glossary terms, naming per location, generated files never edited by hand.
- Run `pnpm check` before every commit (it includes `check:generated`). After any change to a route or contract run `pnpm api:generate`; after any schema change run `pnpm db:generate`. Commit the generated files.
- Every new or changed story needs its reference image: run `pnpm screenshots:update` (Docker; never on the host) and commit the images.
- Routes reach the user only through `request.actor` and decide only through `authorize` or `decide`. Every endpoint behind a permission has one `expectStatuses` test with the standard cast (eight people _(from the organizations plan)_).
- Answers: 401 without a login; 404 for what the actor may not see at all; 403 for what they may see but not change; 409 for a conflict; 429 over a limit. Error bodies follow `apiErrorSchema`; the apps choose the Dutch text from `code` and never show `message`.
- A change, its audit entry, its live events and its queued mail go in one transaction. A mail is queued exactly when the change was committed.
- A job in the mail queue holds IDs and the kind of mail, nothing else. The audit log, the queue and the server logs never hold a name of a person, an email address or a phone number.
- Adding someone never shows the adder a name or a phone number that person did not choose to share with them: someone who has logged in before is not added, and no answer about them holds more than the address that was typed.
- Only the portal's endpoints queue mails. The command-line tool, the seed and the test helpers call the same functions without a queue and send nothing.
- The login code, the request mail and the decision mails keep leaving the API directly, without waiting for the result. The login code mail holds no digit besides the code.
- Links in mails are built from `PUBLIC_ORIGIN`: the app is `{origin}/app/`, the portal `{origin}/`.
- On staging the subject of every mail starts with `[STAGING] `, also of the mails the worker sends; the mailer adds it, never a mail text.
- The API stays backward compatible: only add fields to existing responses.
- Fixtures, seed data and test addresses are made up and end in `@example.test`.
- Dutch copy in this plan is exact. Where a small text is missing, write it in the same style.
- Commit after every task with a message in English, ending with the co-author line your session's instructions give. Do not push after every commit.

Numbers (the spec's, all the author's call there): at most 200 addresses per request; at most 500 people added or invited per account per 24 hours; no second invitation mail for the same person and working group within 24 hours; one mail at a time with at least 2 seconds between two; a failed send is tried 5 more times with growing pauses.

Dutch texts used in more than one task:

| Code or situation             | Text                                                                     |
| ----------------------------- | ------------------------------------------------------------------------ |
| Outcome `added`               | `{adres} is toegevoegd.`                                                 |
| Outcome `approved`            | `{adres} is toegelaten.`                                                 |
| Outcome `invited`             | `{adres} heeft al een account en krijgt een mail.`                       |
| Outcome `already_member`      | `{adres} is al lid.`                                                     |
| Outcome `invalid`             | `'{tekst}' is geen geldig e-mailadres.`                                  |
| A line that is not an address | `Regel {nummer}: '{tekst}' is geen geldig e-mailadres.`                  |
| `too_many_addresses`          | `Voeg hoogstens tweehonderd adressen per keer toe.`                      |
| `too_many_additions`          | `Je hebt vandaag te veel mensen toegevoegd. Probeer het morgen opnieuw.` |
| A pending request on Profiel  | `Je aanmelding bij {werkgroep} wacht op goedkeuring.`                    |

## Review Focus

1. **The same list twice, or the same address from two people at once.** A double click, a resend, two coordinators pasting the same list in the same minute. Nobody gets two memberships, two accounts or two mails, and both answers are a normal list of outcomes. Pinned in Task 5 and Task 6.
2. **A list pasted from a spreadsheet or a mail program.** Windows line ends, tabs and spaces around an address, empty lines, capitals, the same address twice, `Jan Jansen <jan@example.test>`, 250 lines. The form names each wrong line by its number as the person sees it, ignores empty lines and counts doubles once; it never sends while a line is wrong. Pinned in Task 8.
3. **The mail server is down or slow while a list of a hundred is added.** The request answers at once. The worker keeps running, tries each mail again with growing pauses, sends the others in the meantime, and a restart of the worker in the middle loses no mail. Pinned in Task 3.
4. **Things change between queueing and sending.** The person was removed again, deleted their account, or the one who added them is gone: the mail is dropped, or says "Je bent toegevoegd" without a name. A name with markup or a line break never breaks the mail. Pinned in Task 2 and Task 3.
5. **An address that belongs to someone who uses PadVinder already.** A coordinator pastes the address of a volunteer of another organization, by mistake or to see who it is. That person gets no membership and one mail; the answer holds the address and the outcome, never a name or a phone number, and the audit entry holds no address; a second try within 24 hours sends no second mail; and only their own pending request for this group turns the adding into an approval. Pinned in Task 5 and Task 6.

---

### Task 1: `packages/mail`, and a greeting on every mail

**Files:**

- Create: `packages/mail/package.json`, `packages/mail/tsconfig.json`, `packages/mail/vitest.config.ts`, `packages/mail/src/index.ts`, `mailer.ts`, `html.ts`, `mail-error.ts`, `greeting.ts`, `login-code-mail.ts`, `membership-mails.ts` (moved from `apps/api/src/mail/`, with their tests)
- Delete: `apps/api/src/mail/mailer.ts`, `html.ts`, `login-code-mail.ts`, `membership-mails.ts` and their tests
- Modify: `apps/api/src/mail/send-in-background.ts`, `apps/api/src/auth/auth.ts`, `apps/api/src/routes/membership-requests.ts`, `apps/api/src/env.ts`, `apps/api/src/start-api.ts`, `apps/api/src/app.ts`, `apps/api/src/testing/login.ts`, `apps/api/package.json`, `packages/db/src/membership-requests.ts`, `packages/db/src/users.ts`, the root Vitest and TypeScript configs that list the workspace packages
- Test: `packages/mail/src/*.test.ts`, `apps/api/src/auth/login.test.ts`, `apps/api/src/routes/membership-request-mails.test.ts`, `packages/db/src/membership-requests.test.ts`

**Interfaces:**

- Produces (from `@padvinder/mail`): what `apps/api/src/mail/` exported, unchanged unless said here: `Mail`, `Mailer`, `createSmtpMailer`, `createMemoryMailer`, `smtpTransportOptions`, `escapeHtml`, `paragraphsToHtml`, `describeMailError`.
  - `type SmtpSettings = { SMTP_HOST: string; SMTP_PORT: number; SMTP_USER?: string; SMTP_PASSWORD?: string; MAIL_FROM: string; MAIL_SUBJECT_PREFIX?: string }`; the mailer takes it in place of the API's env type. `MAIL_SUBJECT_PREFIX` is the optional setting for staging _(from the organizations plan)_.
  - `smtpSettingsShape`: the Zod fields for those six settings, `MAIL_SUBJECT_PREFIX` with the rules it has in the API's env _(from the organizations plan)_, used by the API's and the worker's env schema, so both read them the same way.
  - The moved `createSmtpMailer` keeps putting `MAIL_SUBJECT_PREFIX` and one space before the subject of every mail it sends _(from the organizations plan)_; its tests move with it. The builders and the memory mailer add nothing.
  - `greeting(name: string, options?: { withoutDigits?: boolean }): string`: `Hallo {naam},` when the name, trimmed and on one line, is not empty; otherwise `Hallo,`. With `withoutDigits`, a name that holds a digit gives `Hallo,`.
  - Every builder takes `recipientName: string` and starts its text and HTML part with the greeting and an empty line: `buildLoginCodeMail({ to, code, recipientName })` (greeting `withoutDigits`), `buildNewRequestMail`, `buildApprovedMail`, `buildRejectedMail`.
  - `buildNewRequestMail({ to, recipientName, applicantName, workingGroupName, requestUrl })`, the changed mail. Subject `Nieuwe aanmelding bij {werkgroep}`. Text, after the greeting: `{naam} wil meedoen met werkgroep {werkgroep}.`, then `Bekijk de aanmelding:` with the link on the next line, then `Je vindt de aanmelding ook in de app, onder Meer > Aanmeldingen.` In the HTML part the link is one button with the text `Bekijk aanmelding`. `requestUrl` stays the app's address for the request, `{origin}/app/more/membership-requests/{id}`. An applicant without a name is still `Iemand`.
- Produces (from `@padvinder/db`):
  - `listRequestNotificationRecipients` returns `{ email: string; name: string }[]` (same people, same order).
  - `findUserNameByEmail(db: Db, email: string): Promise<string | null>`: the name of the account with that address, `null` when there is none or it was deleted.
- `sendInBackground` stays in the API and imports from `@padvinder/mail`. The login code mail looks the name up before it is built; a new address gets `Hallo,`.
- `nodemailer` stays a direct dependency of the API (it is bundled) and becomes one of `packages/mail`, with the same version.

- [ ] **Step 1: Write the failing tests** (move the existing mail tests first; they must keep passing with the greeting added to their expected texts).

```ts
test.each([["Noor de Vries", "Hallo Noor de Vries,"], ["", "Hallo,"], ["  ", "Hallo,"], ["Noor\nBcc: x@example.test", "Hallo Noor Bcc: x@example.test,"]])(
  "greeting(%j) is %j", ...);
test("with withoutDigits, a name that holds a digit gives Hallo,", ...); // "Noor 2" -> "Hallo,"
test("the login code mail starts with the greeting and still holds no digit besides the code", ...);
// recipientName "Agent 007": the text and the HTML hold exactly the six digits of the code
test("every mail starts with Hallo {naam}, or Hallo, and an empty line", ...); // each builder, text and HTML
test("the request mail has one button, Bekijk aanmelding, to the app's address for the request", ...);
test("the request mail says where to find the request in the app", ...);
test("markup in a name is escaped in the greeting", ...); // "<b>Noor</b>"
// login.test.ts (add): a second login of someone named "Noor" gets "Hallo Noor,"; a first login gets "Hallo,"
// membership-request-mails.test.ts (add): each coordinator's mail greets that coordinator by name
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Move the files and implement.**
- [ ] **Step 4: Run.** `pnpm install && pnpm check && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Move mail to a shared package and greet the receiver"`

---

### Task 2: The mail jobs, their texts and the queue

**Files:**

- Create: `packages/db/src/mail-jobs.ts`, `packages/mail/src/appointment-mails.ts`, `packages/mail/src/job-mail.ts`, `packages/mail/src/queue.ts`
- Modify: `packages/db/src/index.ts`, `packages/mail/src/index.ts`, `packages/mail/package.json`
- Test: `packages/db/src/mail-jobs.test.ts`, `packages/mail/src/appointment-mails.test.ts`, `packages/mail/src/job-mail.test.ts`, `packages/mail/src/queue.test.ts`

**Interfaces:**

- Produces (from `@padvinder/db`, `mail-jobs.ts`):
  - `mailJobSchema`, a Zod union on `kind`, and `type MailJob`:
    - `{ kind: "added-to-working-group"; membershipId: string; byUserId: string }`
    - `{ kind: "first-coordinator"; membershipId: string; byUserId: string }`
    - `{ kind: "invited-to-working-group"; userId: string; workingGroupId: string; byUserId: string }`
    - `{ kind: "organization-admin"; userId: string; organizationId: string }`
  - `type QueueMail = (tx: DbTransaction, job: MailJob) => Promise<void>`: queues one mail in the transaction that makes the change. Like `notify`, it accepts no plain `db`.
  - `type MailJobData`, what the texts need, loaded when the mail is sent:
    - for `added-to-working-group` and `first-coordinator`: `{ kind; to: string; recipientName: string; byName: string | null; workingGroupName: string; contactEmail: string | null }`
    - for `invited-to-working-group`: `{ kind; to: string; recipientName: string; byName: string | null; workingGroupName: string }`
    - for `organization-admin`: `{ kind; to: string; recipientName: string; organizationName: string }`
  - `loadMailJobData(db: Db, job: MailJob): Promise<MailJobData | null>`. `null`, and the mail is dropped, when the receiver's account is gone or deleted, when the membership of an `added-to-working-group` or `first-coordinator` job is gone, when the admin row of an `organization-admin` job is gone, or when the working group of an invitation is gone. `byName` is `null` when that account is gone, deleted or has no name.
- Produces (from `@padvinder/mail`):
  - `buildAddedMail({ to, recipientName, byName, workingGroupName, contactEmail, appUrl })`
  - `buildFirstCoordinatorMail({ to, recipientName, byName, workingGroupName, contactEmail, portalUrl })`
  - `buildInvitedMail({ to, recipientName, byName, workingGroupName, appUrl })`
  - `buildOrganizationAdminMail({ to, recipientName, organizationName, portalUrl })`
  - `buildMailForJob(data: MailJobData, origins: { publicOrigin: string }): Mail`: picks the builder; the `kind` of the mail is the job's kind.
  - `MAIL_QUEUE = "mail"` and `MAIL_QUEUE_OPTIONS`: `retryLimit: 5`, `retryDelay: 60`, `retryBackoff: true`, `retryDelayMax: 3600`, `deleteAfterSeconds: 86400` (a finished job is gone within a day).
  - `ensureMailQueue(boss: PgBoss, options = MAIL_QUEUE_OPTIONS): Promise<void>`: creates the queue with those options, and brings an existing queue to them. Safe on every start. Tests pass short retry delays.
  - `createQueueMail(boss: PgBoss): QueueMail`: validates the job with `mailJobSchema` and sends it with pg-boss on the caller's transaction (`fromDrizzle(tx, sql)` as the `db` option of `send`), so the job row is committed or rolled back with the change.
  - `createMemoryMailQueue(): { queueMail: QueueMail; jobs: MailJob[] }`, for tests of the API: it validates the job and keeps it.
- Exact copy, after the greeting. The subject is the first line of each block.

```
Je bent toegevoegd aan werkgroep {werkgroep}

{naam} heeft je toegevoegd aan werkgroep {werkgroep} in PadVinder.

Open PadVinder en log in met dit e-mailadres:
{link naar de app}

Klopt dit niet? Neem contact op met {contactadres}.
```

- Without `byName` the first sentence is `Je bent toegevoegd aan werkgroep {werkgroep} in PadVinder.` Without a contact address the last sentence is left out.
- The mail to a first coordinator has the same subject and last sentence; its first sentence is `{naam} heeft je coördinator gemaakt van werkgroep {werkgroep} in PadVinder.` (without `byName`: `Je bent coördinator van werkgroep {werkgroep} in PadVinder.`), its second `Open het portaal en log in met dit e-mailadres:`, and its link goes to the portal.

```
{naam} wil je toevoegen aan werkgroep {werkgroep}

{naam} wil je toevoegen aan werkgroep {werkgroep} in PadVinder.

Wil je dat? Open PadVinder, ga naar Meer > Profiel en kies "Meld je aan bij nog een werkgroep".
{link naar de app}

Wil je dat niet? Dan hoef je niets te doen.
```

- Without `byName`, `{naam}` is `Iemand` in the subject and the first sentence.

```
Je bent beheerder van {organisatie}

Je bent beheerder van {organisatie} in PadVinder.

Open het portaal en log in met dit e-mailadres:
{link naar het portaal}
```

- [ ] **Step 1: Write the failing tests.**

```ts
// appointment-mails.test.ts
test.each([/* each of the four mails, with and without byName, with and without a contact address */])("%s", ...);
// the whole text part is compared with the blocks above
test("names and addresses are escaped in the HTML part and put on one line in the subject", ...);
// byName "<i>Carla</i>\nBcc: x@example.test", workingGroupName "Noord & Zuid"
// mail-jobs.test.ts
test("a job of each kind parses; a job with a name, an address or an unknown key is refused", ...);
test("loads the receiver, the adder's name, the working group and the organization's contact address", ...);
test("the adder deleted their account: byName is null", ...);
test("the membership was removed again: null", ...);
test("the receiver deleted their account: null", ...);
test("the admin row is gone: null", ...);
// queue.test.ts (a test database and a real pg-boss instance)
test("a job queued in a transaction that commits is in the queue", ...);
test("a job queued in a transaction that rolls back is not", ...);
test("the stored job data holds exactly the IDs and the kind", ...);
test("ensureMailQueue twice changes nothing and sets the retry options", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Check in the installed pg-boss whether `send` with a `db` option works on an instance that was not started; Task 4 depends on the answer.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the mail jobs, their texts and the queue"`

---

### Task 3: The worker sends the queued mails

**Files:**

- Create: `apps/worker/src/jobs/mail.ts`
- Modify: `apps/worker/src/env.ts`, `apps/worker/src/start-worker.ts`, `apps/worker/package.json`, `scripts/smoke-test-image.sh`, `.env.example` (a note that the worker reads the mail settings too)
- Test: `apps/worker/src/jobs/mail.test.ts`, `apps/worker/src/env.test.ts`, `apps/worker/src/start-worker.test.ts`

**Interfaces:**

- Consumes: Task 2's queue and texts; `createSmtpMailer`, `describeMailError`.
- Produces:
  - The worker's env gains `PUBLIC_ORIGIN` (an origin) and the SMTP settings (`smtpSettingsShape`), so also the optional `MAIL_SUBJECT_PREFIX` _(from the organizations plan)_. Missing ones are reported together, each by name, and the worker exits.
  - `registerMailJob(boss: PgBoss, deps: { db: Db; mailer: Mailer; publicOrigin: string; logger: Logger; pauseMs?: number; queueOptions?: typeof MAIL_QUEUE_OPTIONS }): Promise<void>`: calls `ensureMailQueue` and works the queue one job at a time (one worker, batches of one). For each job: `loadMailJobData`; `null` is a dropped mail (logged at `info` with the kind only) and the job is done; otherwise build, send, and wait `pauseMs` (default 2000) before the next.
  - A failed send is logged with the kind and `describeMailError`, never the address or a name, and thrown again, so pg-boss tries it later. After the last try the log says the mail was dropped.
  - `startWorker` makes the SMTP mailer, registers the mail job after the heartbeat job, and closes the mailer in `stop`. The mailer gets the worker's SMTP settings whole, so it puts the prefix before the subject of the worker's mails as it does in the API.
- The smoke test starts the worker with the same mail settings as the API.

- [ ] **Step 1: Write the failing tests** (a test database, a real pg-boss instance, the memory mailer, `pauseMs: 0` unless the test is about the pause).

```ts
test("a queued job becomes one mail to the added person", ...);
test("two jobs are sent one after the other, with the pause between them", ...);
// pauseMs 300: the second mail is sent at least 300 ms after the first
test("a job whose membership is gone is dropped: no mail, no retry", ...);
test("a failing mailer is tried again and the mail goes out once the mailer works", ...);
test("a job that keeps failing ends as failed, and the worker handles the next job", ...);
test("the log of a failure holds the kind and no address or name", ...);
test("a job that was queued while the worker was stopped is sent after it starts", ...);
// env.test.ts
test("the worker names every missing mail setting", ...);
// start-worker.test.ts (the SMTP mailer made from the worker's settings; the memory mailer adds no prefix)
test("with MAIL_SUBJECT_PREFIX the worker's mails start with it", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm build && pnpm release:build --allow-dirty && pnpm release:image && pnpm release:smoke`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Send queued mails from the worker"`

---

### Task 4: The API queues the appointment mails

**Files:**

- Create: `apps/api/src/mail/mail-queue.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/start-api.ts`, `apps/api/src/testing/login.ts`, `apps/api/src/openapi/write-openapi.ts`, `apps/api/src/routes/organizations.ts` _(from the organizations plan)_, `packages/db/src/admin.ts`, `apps/api/package.json`
- Test: `packages/db/src/admin.test.ts`, `apps/api/src/routes/organizations.test.ts` _(from the organizations plan)_, `apps/api/src/mail/mail-queue.test.ts`, `apps/api/src/start-api.test.ts`

**Interfaces:**

- Consumes: `QueueMail`, `createQueueMail`, `ensureMailQueue`, `createMemoryMailQueue`; `createOrganization`, `grantOrganizationAdmin`, `createWorkingGroup` _(from the organizations plan)_.
- Produces:
  - `AppDeps` gains `queueMail: QueueMail`. `createTestApp` passes the memory queue and returns it as `ctx.mailQueue`.
  - `startMailQueue(env: { DATABASE_URL: string }): { queueMail: QueueMail; stop(): Promise<void> }` in `mail-queue.ts`: the API's own pg-boss instance, only to send. It runs no workers, no schedules and no maintenance. It connects and calls `ensureMailQueue` on first use, not at boot, so a database that is down still does not stop the API from starting; a first use that fails is tried again by the next one.
  - `createOrganization`, `grantOrganizationAdmin` and `createWorkingGroup` take an optional last argument `options?: { queueMail?: QueueMail }`. With it, and only when the role was really given and the person is not the actor themself, they queue in their transaction: `organization-admin` for a new admin row, `first-coordinator` for the first coordinator of a new working group.
  - `POST /api/organizations`, `POST /api/organizations/{organizationId}/admins` and `POST /api/organizations/{organizationId}/working-groups` pass the queue. Making an existing member coordinator, or someone platform admin, queues nothing.

- [ ] **Step 1: Write the failing tests.**

```ts
// admin.test.ts
test("without a queue nothing is queued", ...); // the tool, the seed and the cast
test("a new organization queues organization-admin for its first admin", ...);
test("an admin who names themself gets no mail", ...);
test("appointing someone who is an admin already queues nothing", ...);
test("a new working group queues first-coordinator, unless the creator is the coordinator", ...);
test("a create that fails queues nothing", ...); // name_taken
// routes/organizations.test.ts
test("creating an organization queues one job with IDs only", async () => {
  expect(ctx.mailQueue.jobs).toEqual([{ kind: "organization-admin", userId: expect.any(String), organizationId: expect.any(String) }]);
});
// mail-queue.test.ts
test("the API's queue starts on first use and a job sent through it reaches the worker's handler", ...);
// start-api.test.ts
test("the API starts while the database is down", ...); // the existing test still passes
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Queue a mail for an appointed admin and a first coordinator"`

---

### Task 5: Adding a person by address, and tidying up after a removal

**Files:**

- Create: `packages/db/src/add-members.ts`
- Modify: `packages/db/src/audit-log.ts`, `packages/db/src/members.ts`, `packages/db/src/accounts.ts`, `packages/db/src/membership-requests.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/add-members.test.ts`, `packages/db/src/members.test.ts`, `packages/db/src/accounts.test.ts`

**Interfaces:**

- Consumes: `emailAddressSchema`, `users.last_login_at`, `lockWorkingGroup`, `removeMembership` with `last_coordinator`, `deleteAccount` with `blocked` _(all from the organizations plan)_; `decideMembershipRequest`.
- Produces (from `@padvinder/db`):
  - `type AddMemberOutcome = "added" | "approved" | "invited" | "already_member" | "invalid"`
  - `normalizeEmailList(emails: string[]): string[]`: each trimmed and lowercased, empty ones dropped, doubles once, in the order of first appearance.
  - `addMemberByEmail(db: Db, input: { workingGroupId: string; email: string; addedBy: string; now: Date }, options?: { queueMail?: QueueMail }): Promise<{ email: string; outcome: AddMemberOutcome; approvedRequest?: MembershipRequestReviewRecord }>`, one transaction per call. `email` in the answer is the normalized address, or the text as given for `invalid`. In this order:
    1. Not an address by `emailAddressSchema` (which also refuses `@deleted.invalid`): `invalid`.
    2. No account: one is made, with an empty name. Then as step 6.
    3. Already a member of this group: `already_member`; nothing changes.
    4. The account has logged in before (`last_login_at` is set) and has a pending request for this group: the request is approved through `decideMembershipRequest`, decided by `addedBy`: `approved`, with the request in `approvedRequest`. No queued mail: the route sends part 1's approval mail.
    5. The account has logged in before, without such a request: no membership. `invited`. Unless an entry `membership.invited` for this person and group was written in the 24 hours before `now`: one entry `membership.invited` and a queued `invited-to-working-group`.
    6. Otherwise (the account never logged in): a membership as a volunteer, one entry `membership.added`, `access-changed` for the person, and a queued `added-to-working-group`: `added`.
  - Both entries have the person as subject, the group's organization, and details `{ workingGroupId }`.
  - `countAdditionsInLastDay(db: Db, userId: string, now: Date): Promise<number>`: the entries `membership.added` and `membership.invited` with that actor in the 24 hours before `now`.
  - New `AuditAction`s: `membership.added`, `membership.invited`.
  - `deleteAccount` input gains `deletedBy?: AuditActor` (the actor of `account.deleted`; by default the user) and `onlyIfUnused?: boolean`. With `onlyIfUnused` the account is deleted only when, read again under the locks, it never logged in and has no membership, no admin row, no pending request and no platform admin flag; otherwise the new outcome `kept`.
  - `removeMembership` answers `{ outcome: "removed"; accountDeleted: boolean }`: after the removal is committed it calls `deleteAccount` for the removed person with `onlyIfUnused` and `deletedBy` the remover, in a second transaction (the first holds the working group's lock, and deleting an account takes its locks in another order).
- Adding to a working group that is switched off works: its admins can only make someone coordinator, and so switch it on, when it has members.

- [ ] **Step 1: Write the failing tests** (`queueMail` a memory queue).

```ts
test("a new address gets an account without a name, a membership, one entry, the event and one queued mail", ...);
test("an account that never logged in is added the same way", ...);
test("a member is already_member and nothing changes", ...);
test("someone who logged in before is not added", async () => {
  const result = await addMemberByEmail(t.db, { workingGroupId, email: "Bekend@Example.test", addedBy, now }, { queueMail });
  expect(result).toEqual({ email: "bekend@example.test", outcome: "invited" });
  // no membership; one entry membership.invited; one job invited-to-working-group; the result holds no name and no phone number
});
test("a second invitation within 24 hours writes no entry and queues no mail; after 24 hours it does", ...);
test("someone who logged in before and asked for this group is approved, decided by the adder", ...);
// outcome approved, the request approved with decided_by_user_id the adder, a membership, no queued mail
test("a pending request for another group does not count", ...); // invited
test.each(["jan@", "", "deleted-0192f3c0-0000-7000-8000-000000000001@deleted.invalid"])("%j is invalid and nothing is written", ...);
test("the same address from two people at the same moment gives one account, one membership and one mail", ...);
// outcomes sorted: ["added", "already_member"]
test("the same call twice: added, then already_member, and one mail in total", ...);
test("normalizeEmailList trims, lowers, drops empty lines and counts doubles once", ...);
test("countAdditionsInLastDay counts added and invited of this actor, not approvals and not older ones", ...);
// members.test.ts
test("removing someone who never logged in and has nothing else deletes the account", ...);
// accountDeleted true; the user row is soft-deleted; account.deleted names the remover as actor
test("removing someone who never logged in but is in another group keeps the account", ...);
test("removing someone who logged in keeps the account", ...);
// accounts.test.ts
test("onlyIfUnused keeps an account that got a membership in the meantime", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add a person to a working group by email address"`

---

### Task 6: The endpoint for adding people

**Files:**

- Create: `packages/contracts/src/add-members.ts`, `packages/contracts/src/fixtures/add-members.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/fixtures/index.ts`, `packages/contracts/src/errors.ts`, `apps/api/src/permissions/rules.ts`, `apps/api/src/routes/working-groups.ts`, `apps/api/src/routes/memberships.ts`, `apps/api/src/app.ts`
- Create (generated): the OpenAPI file and client
- Test: `packages/contracts/src/add-members.test.ts`, `apps/api/src/permissions/rules.test.ts`, `apps/api/src/routes/add-members.test.ts`, `apps/api/src/routes/members.test.ts`

**Interfaces:**

- Consumes: Task 5; `afterMembershipRequestDecided`'s mail (move it to where both routes reach it).
- Produces (contracts):
  - `addMembersRequestSchema` (component `AddMembersRequest`): strict `{ emails: string[] }`, 1 to 1000 texts of at most 320 characters. The texts are not checked as addresses here: a wrong one is an outcome, not a 400.
  - `addMemberOutcomeSchema` (component `AddMemberOutcome`) and `addMembersResponseSchema` (component `AddMembersResponse`): `{ results: { email: string; outcome: AddMemberOutcome }[] }`.
  - `MAX_ADDRESSES_PER_REQUEST = 200`, used by the API and the form.
  - New error codes: `tooManyAddresses: "too_many_addresses"`, `tooManyAdditions: "too_many_additions"`.
  - Fixture `addMembersResultFixture`: one result of each outcome.
- Produces (API):
  - `Permission` gains `{ action: "workingGroup.addMembers"; target: WorkingGroupTarget }`: allowed for a coordinator of the group, an admin of its organization and a platform admin; forbidden for a volunteer of the group; hidden for everyone else.
  - `POST /api/working-groups/{workingGroupId}/members` (operationId `addMembers`): 200 `AddMembersResponse`; 400; 401; 403; 404; 429.
    - The list is normalized with `normalizeEmailList`. More than 200 addresses: 429 `too_many_addresses`. More addresses than 500 minus `countAdditionsInLastDay`: 429 `too_many_additions`. In both cases nothing changes.
    - Then one `addMemberByEmail` per address, in order, each in its own transaction, with the queue. One result per address, in that order.
    - The daily limit is checked once, before the first address. Two requests of one account at the same moment can together pass it by at most one list; that is accepted.
    - For each `approved`, the applicant gets part 1's approval mail, sent as that route sends it.
  - `DELETE /api/memberships/{membershipId}` does not change its answer; the account of a removed person who never logged in is deleted as Task 5 says.

- [ ] **Step 1: Write the failing tests.**

```ts
// routes/add-members.test.ts
test("coordinators and admins of the group add people, nobody else", async () => {
  let n = 0;
  await expectStatuses(cast, { platformAdmin: 200, organizationAdmin: 200, coordinator: 200, volunteer: 403, volunteerOtherGroup: 404, coordinatorOtherOrganization: 404, organizationAdminOtherOrganization: 404, applicant: 404, anonymous: 401 },
    (headers) => ctx.app.inject({ method: "POST", url: `/api/working-groups/${cast.workingGroup.workingGroupId}/members`, headers, payload: { emails: [`nieuw-${n++}@example.test`] } }));
});
test("a list with every kind of address gives one outcome each, in order", async () => {
  // a new address, a never-used account, a person with a profile, one with a profile and a pending request for this group,
  // a member, the new address again in capitals, and "jan@"
  expect(res.json().results.map((r) => r.outcome)).toEqual(["added", "added", "invited", "approved", "already_member", "invalid"]);
  // two memberships more than before, plus the approved one; two jobs added-to-working-group and one invited-to-working-group; one approval mail in the memory mailer
});
test("the raw answer holds no name and no phone number of the person with a profile", ...);
test("the same list again changes nothing and queues nothing", ...);
test("201 addresses are 429 too_many_addresses and nobody is added", ...);
test("200 addresses that are all one address count as one", ...);
test("the 501st person of the day is 429 too_many_additions", ...);
// 400 entries membership.added with this actor written directly, then a list of 101 new addresses: 429; a list of 100: 200
test("an empty list, a body without emails and an unknown key are 400", ...);
test("an unknown working group is 404", ...);
test("the audit entries name the adder and hold no address", ...);
test("a POST from a foreign Origin is refused", ...);
// rules.test.ts (add): the row for workingGroup.addMembers
// routes/members.test.ts (add)
test("removing a person who was added by mistake and never logged in frees the address", ...);
// after the DELETE, adding the same address again answers added, with a new account
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the endpoint for adding people to a working group"`

---

### Task 7: `packages/api-client`: adding people

**Files:**

- Modify: `packages/api-client/src/administration.ts` _(from the organizations plan)_, `packages/api-client/src/membership.ts`, `packages/ui/src/lib/messages.ts`, `packages/ui/src/index.ts`
- Test: `packages/api-client/src/administration.test.tsx`, `packages/api-client/src/membership.test.tsx`, `packages/ui/src/lib/messages.test.ts`

**Interfaces:**

- Consumes: the generated `addMembers`; `refetchAdministration` _(from the organizations plan)_.
- Produces (from `@padvinder/api-client`):
  - `useAddMembers()`: a mutation `{ workingGroupId: string; emails: string[] }` that gives the results, throws the API's error body, and calls `refetchAdministration` when it settles.
  - `otherWorkingGroups(me: MeResponse, directory: WorkingGroupSummary[]): WorkingGroupSummary[]`: the directory without the groups the user is a member of and without the group of a pending request.
- Produces (from `@padvinder/ui`):
  - `addMemberOutcomeMessage(result: { email: string; outcome: AddMemberOutcome }): string`: the five texts in the table at the top.
  - `apiErrorMessage` gains `too_many_addresses` and `too_many_additions`.

- [ ] **Step 1: Write the failing tests.**

```ts
test("useAddMembers gives the results and refetches the member lists and the managed groups", ...);
test("a 429 surfaces with its code", ...);
test("otherWorkingGroups leaves out the user's groups and the group they asked for", ...);
test.each([/* the five outcomes */])("%j gives %j", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add adding people to the API client"`

---

### Task 8: `packages/ui`: the form for adding people, and another working group on the profile

**Files:**

- Create: `packages/ui/src/lib/email-lines.ts`, `packages/ui/src/components/administration/add-members-form.tsx`, `add-members-results.tsx`, a `.stories.tsx` next to each component
- Modify: `packages/ui/src/components/profile/profile-form.tsx` and its stories, `packages/ui/src/index.ts`
- Create (generated): reference images
- Test: next to each file

**Interfaces:**

- Consumes: `isEmailAddress` _(from the organizations plan)_, `MAX_ADDRESSES_PER_REQUEST`, `addMemberOutcomeMessage`.
- Produces (from `@padvinder/ui`):
  - `parseEmailLines(text: string): { emails: string[]; errors: { line: number; text: string }[] }`: splits on every kind of line end, trims each line, skips empty ones, and checks each with `isEmailAddress`. `line` is the number of the line as the person sees it, counting empty lines. `emails` holds the right ones as typed and trimmed; doubles stay, the API counts them once.
  - `AddMembersForm(props: { onSubmit(emails: string[]): void; pending: boolean; error?: string })`: one text area `E-mailadressen`, with below it `Eén adres per regel. Iedereen krijgt een mail.`, and the button `Voeg toe`. While the text is typed or pasted, each wrong line shows as `Regel {nummer}: '{tekst}' is geen geldig e-mailadres.`, and more than 200 different addresses show the text for `too_many_addresses`. The button is disabled while a line is wrong, the list is too long or there is no address.
  - `AddMembersResults(props: { results: { email: string; outcome: AddMemberOutcome }[]; onClose(): void })`: one line per result with `addMemberOutcomeMessage`, in the order of the answer, and the button `Sluit`.
  - `ProfileForm` gains `pendingRequest?: { workingGroupName: string }`, `onWithdrawRequest?(): void`, `withdrawing?: boolean` and `onJoinAnother?(): void`. With `pendingRequest`, below the working groups: the text for a pending request in the table at the top and the button `Trek aanmelding in`. Without it and with `onJoinAnother`: the button `Meld je aan bij nog een werkgroep`.
- Stories: the form (Empty, WithWrongLines, TooMany, Pending, WithError); the results (`addMembersResultFixture`); the profile (WithPendingRequest, CanJoinAnother).

- [ ] **Step 1: Write the failing tests.**

```tsx
test("parseEmailLines names each wrong line by its number, counting empty lines", () => {
  expect(parseEmailLines("noor@example.test\r\n\r\njan@\n  Bram@Example.test \t\nJan Jansen <jan@example.test>")).toEqual({
    emails: ["noor@example.test", "Bram@Example.test"],
    errors: [{ line: 3, text: "jan@" }, { line: 5, text: "Jan Jansen <jan@example.test>" }],
  });
});
test("parseEmailLines of an empty text or only empty lines has no emails and no errors", ...);
test("the form shows Regel 3: 'jan@' is geen geldig e-mailadres. and disables the button", ...);
test("the form submits the right lines once every line is right", ...);
test("201 different addresses show the text and disable the button; 201 lines of one address do not", ...);
test("the results show one line per address and call onClose", ...);
test("the profile shows the pending request with Trek aanmelding in, or the button to join another group, never both", ...);
test("markup in a line is shown as text", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm screenshots:update && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the form for adding people and the profile's button for another working group"`

---

### Task 9: Portal: "Voeg mensen toe"

**Files:**

- Create: `apps/portal/src/pages/add-members.tsx`
- Modify: `apps/portal/src/pages/working-group-page.tsx` _(from the organizations plan)_
- Test: `apps/portal/src/pages/working-group-page.test.tsx`

**Interfaces:**

- Consumes: Tasks 7 and 8; `Modal`, `showToast`; `relationToWorkingGroup`.
- Produces: on a working group's page, above the members, the button `Voeg mensen toe`, for a coordinator of the group, an admin of its organization and a platform admin. It opens `AddMembersForm` in a `Modal` titled `Mensen toevoegen`. After the answer the same modal shows `AddMembersResults`; `Sluit` closes it, and the members table holds the added people (as "(nog niet ingelogd)"). A 429 shows its text above the button and keeps what was typed. The modal cannot be closed while the request runs.

- [ ] **Step 1: Write the failing tests** (`renderPortal`).

```tsx
test("a coordinator adds two addresses and sees one line for each", ...);
// the POST body holds both addresses; the member list is fetched again
test("a wrong line keeps the button disabled and nothing is sent", ...);
test("a 429 shows its text and keeps the list", ...);
test("a volunteer of the group who opens its page sees the not-found page, as before", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and look.** `pnpm check && pnpm build`. Then `pnpm dev`, log in on the portal as `coordinator@example.test`, add two made-up addresses and `vrijwilliger@example.test`, and read the two mails in Mailpit. Save a screenshot of the results to `.context/add-members.png`.
- [ ] **Step 5: Commit.** `git commit -m "Add people to a working group from the portal"`

---

### Task 10: The app: asking for another working group

**Files:**

- Create: `apps/mobile/src/screens/more/join-another-screen.tsx`
- Modify: `apps/mobile/src/screens/more/profile-screen.tsx`, `apps/mobile/src/router.tsx`
- Test: `apps/mobile/src/screens/more/join-another-screen.test.tsx`, `apps/mobile/src/screens/more/profile-screen.test.tsx`, `apps/mobile/src/router.test.tsx`

**Interfaces:**

- Consumes: `otherWorkingGroups`, `useCreateMembershipRequest`, `useWithdrawMembershipRequest`, `listWorkingGroupsOptions`, `WorkingGroupPicker`, `newId`; Task 8's `ProfileForm` props.
- Produces:
  - `ProfileScreen` (the one under the Meer tab, not the applicant's) passes `pendingRequest` when `me.membershipRequest` is pending, with `Trek aanmelding in` withdrawing it, and otherwise `onJoinAnother`, which opens `/more/profile/join`. A rejected request shows nothing here.
  - `/more/profile/join`: part 1's picker with `otherWorkingGroups(me, directory)`. The ID and time of the request are made when the user taps, and kept for a second tap on the same group, as the applicant's picker does. After the request is stored the app goes back to Profiel, which now shows the pending request. No other group left: `Je bent al lid van alle werkgroepen.`
  - The applicant's profile (before any membership) does not change.
  - After the approval the member's `/api/me` holds both working groups, without a reload (`access-changed`).

- [ ] **Step 1: Write the failing tests.**

```tsx
test("a member sees Meld je aan bij nog een werkgroep, and the picker without their own group", ...);
test("choosing a group sends one request with an id made at the tap, and returns to Profiel", ...);
test("a second tap after a failed send uses the same id", ...);
test("with a pending request Profiel shows the waiting text and Trek aanmelding in, and no button to join another", ...);
test("Trek aanmelding in withdraws the request and the button comes back", ...);
test("the picker's errors show as on the applicant's picker", ...); // too_many_requests, a group that is gone
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Ask for another working group from the profile"`

---

### Task 11: End-to-end tests and documentation

**Files:**

- Create: `e2e/portal-adding-people.spec.ts`
- Modify: `e2e/joining.spec.ts` (only if the changed request mail changes what it reads), `e2e/helpers/mailpit.ts` (only if a helper is missing), `AGENTS.md`, `infra/alwaysdata/README.md`, `scripts/lib/ci-jobs.ts` and its test (only if needed: a path no rule names already runs `e2e` and `release`)

**Interfaces:**

- Consumes: `newAddress`, `createSession`, `runAdmin`, `createWorkingGroup`, `makeVolunteer`, `readMail`; the Playwright projects `portal` (laptop-sized) and `chromium` (phone-sized). The worker runs under `pnpm dev`, so a queued mail is in Mailpit within a few seconds.

- [ ] **Step 1: Write the tests.**

```ts
// portal-adding-people.spec.ts
test("a platform admin makes an organization and a group and adds two people with a pasted list", async ({
  browser,
}) => {
  // Nieuwe organisatie and Nieuwe werkgroep as in the organizations plan's test; then Voeg mensen toe with two fresh addresses and a wrong third line:
  // "Regel 3: …" shows and Voeg toe is disabled; without the line both get "… is toegevoegd." and stand in Leden as "(nog niet ingelogd)".
  // readMail(first, "Je bent toegevoegd aan werkgroep"): the text names the working group and holds the link to /app/.
  // In a second, phone-sized context that person opens the link, logs in with the code from the mail, gives a name and lands on the tabs.
});
test("someone who has an account gets an invitation instead, and asks for the group in the app", async ({
  browser,
}) => {
  // A volunteer of another organization's group. The coordinator adds their address: "… heeft al een account en krijgt een mail."
  // The mail's subject ends in "wil je toevoegen aan werkgroep …". In the app: Meer, Profiel, Meld je aan bij nog een werkgroep, choose the group:
  // Profiel shows "Je aanmelding bij … wacht op goedkeuring." The coordinator adds the address again: "… is toegelaten."
  // The volunteer's Profiel lists both working groups without a reload.
});
```

- [ ] **Step 2: Run.** `pnpm test:e2e` three times. Expected: PASS each time.
- [ ] **Step 3: Update `AGENTS.md`.**
  - Current state and repository layout: `packages/mail`; adding people and asking for another working group; what is left of this part, with the requests page while `2026-11-25-requests-in-the-portal.md` is not merged.
  - Backend: mail texts and the mailer live in `packages/mail`; every mail starts with `greeting`; which mails leave the API directly and which go through the queue; a queued mail is a `MailJob` with IDs only, queued with `queueMail(tx, job)` in the transaction of the change, and `loadMailJobData` decides at sending time whether it still goes out; how to add a kind of mail (a union member, its data, its text, a case in `buildMailForJob`); the API has a pg-boss instance only to send.
  - Roles and permissions: adding by address and why someone who has logged in is invited instead; the limits; removing a person who never logged in deletes the account.
  - Development workflow: the worker needs the mail settings; a queued mail reaches Mailpit through the worker.
  - Open technical points: the mail queue on Alwaysdata is not verified yet.
- [ ] **Step 4: Update `infra/alwaysdata/README.md`.** "What runs where": the worker sends mail and reads the mail settings from the shared env file. "Verification": new rows, all open: a queued mail leaves the worker on staging; a list of twenty addresses arrives with the pause and none in the spam folder; whether the greeting above the code line keeps a phone from offering the code.
- [ ] **Step 5: Check the CI rules,** then run everything: `pnpm check && pnpm build && pnpm test:e2e && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Add end-to-end tests for adding people, and document the mail queue"`

## Deviations

Recorded while building, 25 November 2026. One line each: what, and why.

- Task 1: the API test helper `requestCode` (`apps/api/src/testing/login.ts`) waits until the login mail to that address has arrived, because the login code mail now looks the name up first and `codeFor` raced it. `@padvinder/mail` is a devDependency of the API and the worker, like `@padvinder/contracts` and `@padvinder/db`: the apps bundle it, and `nodemailer` and `pg-boss` stay direct dependencies of each app.
- Task 2: pg-boss 12.38.2 does not take `send` with a `db` option on an instance that was not started (it looks the queue up on its own connection first), so the API's instance is started on its first mail (Task 4). `packages/mail` also depends on `drizzle-orm`, because pg-boss's `fromDrizzle` needs its `sql` tag. An adder whose name is only spaces counts as having no name.
- Task 3: the worker throws an error that holds only the kind and `describeMailError`, because pg-boss stores what a handler throws with the job and an SMTP reply can name the address. The pause comes before the next send rather than after this one (same spacing; a worker stopped during the pause cannot send the finished mail twice). The pause test uses 2.5 s, because pg-boss's 2 s polling alone already spaces two mails 2 s apart.
- Task 4: `startMailQueue` keeps pg-boss's `migrate` on, so the API can create pg-boss's schema on a fresh database before the worker ever ran; this also runs pg-boss's background-migration poller and queue-cache refresh in the API process. The instance has its own pool of 2 connections (connect 2 s, query 31 s), and a failed start is stopped before the next try. `startMailQueue` takes an optional `onError`, so pg-boss's errors reach the log and cannot end the process. With the system as actor nothing is queued, also when a queue is passed.
- Task 5: the approval inside `addMemberByEmail` goes through a new sibling, `decideMembershipRequestInTransaction`, so the whole call is one transaction; `decideMembershipRequest` is unchanged. `findOrCreateUser` is exported. `addMemberByEmail` starts its transaction again (at most three times) when the account appeared in between, to keep `deleteAccount`'s lock order. `deleteAccount` gains the outcome `kept`. `onlyIfUnused` also keeps an account whose `email_verified` is set, because a first login verifies the address just before `last_login_at` is set. `removeMembership` returns `cleanupError` when deleting the unused account fails; the removal stands and the route logs only the error's class and database code.
- Task 5: both 24-hour windows (the daily limit and the second invitation) have a lower bound only: an entry's time is the database's, `now` is the API's, and with an upper bound two invitations at the same moment could each miss the other's entry and send two mails.
- Task 6: the approval mail moved to `apps/api/src/mail/request-decided-mail.ts`, shared by the request and the adding routes.
- Task 8: `AddMembersForm` has an optional `initialText`, because the visual tests render stories without play functions.
- Task 10: the applicant picker's logic (the ID made at the tap and kept for a second tap on the same group, the error texts) moved to `apps/mobile/src/lib/use-join-working-group.ts`, used by the applicant's picker and by `/more/profile/join`.
- Final review: an invitation to a working group that is switched off is dropped when it would be sent (the group is not in the app's list, so the mail would lead nowhere); an added mail to such a group still goes out. A first-coordinator mail is dropped when the person is no longer coordinator. The form shows at most ten wrong lines, then "En nog {N} regels met een ongeldig e-mailadres.", in one alert region linked to the field. AGENTS.md says that locally the portal link in a mail opens the app's dev server, because `PUBLIC_ORIGIN` is the mobile origin there.
- Accepted, not changed: two requests of one account at the same moment can together pass the daily limit (as the plan says); an admin who adds their own address, which has logged in, gets an invitation mail to themselves; a member list shows an added person's name only after a reload once they first log in (no live event for a first login).
