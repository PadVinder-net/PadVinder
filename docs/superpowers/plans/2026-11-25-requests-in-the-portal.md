# Membership Requests in the Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build pull request 3b of "Portal administration": a coordinator or admin handles membership requests in the portal, on a page with a modal for one request, from the one link in the mail, which ends in the portal on a laptop and in the app on a phone.

**Architecture:** One new endpoint lists the open requests of every working group a user reviews; approving and rejecting stay part 1's endpoints. The portal gets a requests page with a modal on the list; the request in the modal is in the address, and opening an address decides nothing. The app and the portal send a browser on to each other by the size of the device's screen, before any login.

**Tech Stack:** The existing stack. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-22-portal-administration-design.md` (read it, the design of part 1 `2026-11-21-accounts-and-access-design.md`, and `AGENTS.md` before starting any task). This plan covers the second half of item 3 under "Order of work". The maintainer decided on 25 November 2026 to build that item as two pull requests: 3a, `2026-11-25-adding-people.md`, and 3b, this plan. This half holds the requests page with its modal and the forwarding between app and portal. The other half holds adding by address, `packages/mail`, the mail queue, the new mails, the changed request mail, and asking for another group in the app.

**Builds on:** the pull request of `2026-11-25-organizations-working-groups-and-roles.md`, merged or as a branch to stack on: work on a branch stacked on its branch when it is not merged yet. Names marked _(from the organizations plan)_ come from that plan, not from code: check the real name before you use it, read the "Deviations" at the end of that plan, and keep the behavior asked here. That plan already built `managesSomething`, the navigation item `Werkgroepen`, `pendingRequestCount` on the managed working groups, and the cast of eight people; this plan uses them. This plan does not need `2026-11-25-adding-people.md` (pull request 3a), and that plan does not need this one: part 1's request mail already links to the app's address for the request, and 3a keeps that address. Whichever of the two is built second rebases on the first and resolves the shared files: `apps/portal/src/layout/navigation.ts`, `packages/ui/src/lib/messages.ts`, `packages/ui/src/index.ts`, `packages/api-client/src/administration.ts` and `membership.ts`, and `AGENTS.md`; also `packages/db/src/membership-requests.ts`, `apps/api/src/routes/membership-requests.ts`, `infra/alwaysdata/README.md`, and the generated OpenAPI file and client, which are made again with `pnpm api:generate`, never merged by hand.

## Global Constraints

- AGENTS.md applies in full: English code, Dutch UI copy with "je", English kebab-case URL paths, glossary terms, naming per location, generated files never edited by hand.
- Run `pnpm check` before every commit (it includes `check:generated`). After any change to a route or contract run `pnpm api:generate`; after any schema change run `pnpm db:generate`. Commit the generated files.
- Every new or changed story needs its reference image: run `pnpm screenshots:update` (Docker; never on the host) and commit the images. A story of a table asks for a wide viewport with `visualViewport`.
- Routes reach the user only through `request.actor` and decide only through `authorize` or `decide`. Every endpoint behind a permission has one `expectStatuses` test with the standard cast (eight people _(from the organizations plan)_).
- Answers: 401 without a login; 404 for what the actor may not see at all; 403 for what they may see but not change; 409 for a conflict. Error bodies follow `apiErrorSchema`; the apps choose the Dutch text from `code` and never show `message`.
- Opening a link changes nothing. A request is decided only by a press on "Keur goed" or "Wijs af".
- The API stays backward compatible: only add fields to existing responses.
- Fixtures, seed data and test addresses are made up and end in `@example.test`.
- Dutch copy in this plan is exact. Where a small text is missing, write it in the same style.
- Commit after every task with a message in English, ending with the co-author line your session's instructions give. Do not push after every commit.

Dutch texts used in more than one task:

| Code or situation                      | Text                                 |
| -------------------------------------- | ------------------------------------ |
| A request decided or withdrawn already | `Deze aanmelding is al behandeld.`   |
| A request the user may not see         | `Deze aanmelding bestaat niet meer.` |

## Review Focus

1. **The link from the mail, opened by anyone, anywhere.** On a laptop without a login, on a phone, by a coordinator of another group, twice, after a colleague decided. It ends in the right place after the login, shows the modal only for a request that is still open and visible to this person, and decides nothing. Pinned in Task 4 and Task 5.
2. **A colleague decides while the modal is open.** Two coordinators have the same request in front of them; one presses "Keur goed", and a moment later the other presses "Wijs af". The second answer is 409 `already_decided`: the modal closes with the toast "Deze aanmelding is al behandeld.", and the first decision stands. Pinned in Task 4.
3. **A reviewer of more than one organization.** A platform admin's list holds the requests of every organization; an admin who also coordinates a group gets each of its requests once; an admin of another organization gets none of this one's. The page names the organization next to a working group only when the list spans more than one. Pinned in Task 1, Task 3 and Task 4.
4. **The requests page opened on a phone.** The portal's `/membership-requests` sends a phone to the app's list, and with a request in the address to the app's screen for it, before any login. A phone held sideways is still a phone, a tablet and a laptop are not, and an `id` that is not a UUID never ends up in the app's address. Pinned in Task 5 and Task 6.
5. **The list changes through the live event while a modal is open.** A colleague decides another request, an applicant withdraws, or a new request comes in. The list behind the modal follows; the modal of a request that is still open stays as it is; the modal of a request that is gone closes with "Deze aanmelding is al behandeld.", and nothing is decided. Pinned in Task 2 and Task 4.

---

### Task 1: The list of open requests for a reviewer

**Files:**

- Modify: `packages/db/src/membership-requests.ts`, `packages/contracts/src/membership-requests.ts`, `packages/contracts/src/fixtures/membership-requests.ts`, `apps/api/src/routes/membership-requests.ts`
- Create (generated): the OpenAPI file and client
- Test: `packages/db/src/membership-requests.test.ts`, `apps/api/src/routes/membership-requests-review.test.ts`

**Interfaces:**

- Produces (from `@padvinder/db`): `listReviewablePendingRequests(db: Db, access: Access): Promise<MembershipRequestReviewRecord[]>`: the pending requests of every working group for a platform admin; otherwise of the groups of the organizations in `adminOfOrganizationIds` and of the groups in `memberships` with the coordinator flag. Each request once. Sorted by organization name, then working group name, in Dutch order, then oldest first.
- Produces (API): `GET /api/membership-requests` (operationId `listReviewableMembershipRequests`): 200 `MembershipRequestListResponse` for every logged-in user, empty for who reviews nothing; 401. The applicants' contact details are in it, as in the list per group.
- Fixture `reviewableRequestsFixture`: three pending requests in two working groups of one organization.

- [ ] **Step 1: Write the failing tests.**

```ts
test("everyone logged in gets their own list", ...); // 200 for all eight, 401 anonymous
test("the list: every request for the platform admin, those of the organization for its admin, those of the group for its coordinator, none for a volunteer and for the applicant themself", ...);
test("an admin of another organization does not get this organization's requests", ...);
test("a decided or withdrawn request is not in the list", ...);
test("an admin who also coordinates a group gets its requests once", ...);
test("the requests are grouped by working group in Dutch order, oldest first", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement,** then `pnpm api:generate`.
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "List the open requests of every group a user reviews"`

---

### Task 2: `packages/api-client`: the requests list

**Files:**

- Modify: `packages/api-client/src/membership.ts`
- Test: `packages/api-client/src/membership.test.tsx`

**Interfaces:**

- Consumes: the generated `listReviewableMembershipRequests` (Task 1).
- Produces (from `@padvinder/api-client`):
  - `useReviewableMembershipRequests()`: the list query.
  - `refetchMembershipRequests` also invalidates `listReviewableMembershipRequests`, whatever the working group.

- [ ] **Step 1: Write the failing tests.**

```ts
test("membership-requests-changed refetches the reviewer's list", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the reviewer's requests list to the API client"`

---

### Task 3: `packages/ui`: the requests table

**Files:**

- Create: `packages/ui/src/components/joining/membership-request-table.tsx`, a `.stories.tsx` next to it
- Modify: `packages/ui/src/components/joining/membership-request-detail.tsx` and its stories, `packages/ui/src/index.ts`
- Create (generated): reference images
- Test: next to each file

**Interfaces:**

- Consumes: `displayName`, the `Table` parts; `reviewableRequestsFixture` (Task 1).
- Produces (from `@padvinder/ui`):
  - `MembershipRequestTable(props: { groups: { workingGroup: WorkingGroupSummary; requests: MembershipRequestForReview[] }[]; showOrganization: boolean; onOpen(requestId: string): void })`: per working group a heading (the group's name, followed by its organization's with `showOrganization`) and a table with the columns `Naam` and `Aangemeld op`; the name is a button that calls `onOpen`. Groups without requests are left out. No request at all: `Er zijn geen open aanmeldingen.`
  - `MembershipRequestDetail` gains `confirmReject?: boolean` (default `true`, the app) and `heading?: boolean` (default `true`). With `confirmReject` false, `Wijs af` calls `onReject` at once; with `heading` false the name is not repeated, because the modal's title holds it.
- Stories: the table (Default with `reviewableRequestsFixture`, WithOrganizations, Empty); the detail (WithoutConfirm).

- [ ] **Step 1: Write the failing tests.**

```tsx
test("the table groups by working group and shows the organization only when asked", ...);
test("without confirmReject, Wijs af calls onReject at once and there is no Annuleer", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm screenshots:update && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the requests table and a request detail without a confirm step"`

---

### Task 4: Portal: the requests page with its modal

**Files:**

- Create: `apps/portal/src/pages/membership-requests-page.tsx`
- Modify: `apps/portal/src/layout/navigation.ts`, `apps/portal/src/layout/portal-layout.tsx`, `apps/portal/src/router.tsx`
- Test: `apps/portal/src/pages/membership-requests-page.test.tsx`, `apps/portal/src/layout/navigation.test.ts`, `apps/portal/src/layout/portal-layout.test.tsx`

**Interfaces:**

- Consumes: Tasks 2 and 3; `getMembershipRequestOptions`, `useApproveMembershipRequest`, `useRejectMembershipRequest`; `useManagedWorkingGroups` _(from the organizations plan)_; `Modal`, `showToast`, `NotFoundPage`.
- Produces:
  - `navigationFor(me)` gains `{ label: "Aanmeldingen", to: "/membership-requests" }` right after `Werkgroepen`, for everyone for whom `managesSomething(me)` holds. The layout shows the number of open requests next to it when it is above zero (the sum of `pendingRequestCount` of the managed working groups), and names the link `Aanmeldingen, {aantal} open`.
  - `/membership-requests`: heading `Aanmeldingen` and `MembershipRequestTable` with `useReviewableMembershipRequests()`, with `showOrganization` when the requests span more than one organization. Someone for whom `managesSomething(me)` does not hold sees `NotFoundPage`. Loading: `Aanmeldingen laden…`. A failed load: the connection text with `Probeer opnieuw`.
  - Choosing a row puts `?request={id}` in the address. With that in the address, however the page was reached, and the request in the list: a `Modal` titled with the applicant's name (`displayName`), holding `MembershipRequestDetail` with `confirmReject` and `heading` false: email address, phone number, working group, `Aangemeld op {datum}`, `Keur goed` and `Wijs af`. The modal closes through the cross, Escape and a click beside it; each takes the request out of the address and decides nothing. It cannot be closed while a decision runs.
  - After a decision the modal closes, the address loses the request, and the toast says `{naam} is toegelaten tot {werkgroep}.` or `De aanmelding van {naam} is afgewezen.`, with `nameInSentence`.
  - With `?request={id}` and the list loaded without that request: no modal. The page asks `GET /api/membership-requests/{id}` once: an answer (the request is decided or withdrawn) gives the toast `Deze aanmelding is al behandeld.`; a 403 or 404 gives `Deze aanmelding bestaat niet meer.` Then the address loses the request. A decision that answers 409 `already_decided` closes the modal with the first toast.
  - The page sends no request that changes anything until a button is pressed.

- [ ] **Step 1: Write the failing tests** (`renderPortal`, `mockFetch`, which records every call).

```tsx
test("navigationFor puts Aanmeldingen after Werkgroepen for a coordinator", ...);
test("the layout shows the number of open requests, and nothing at zero", ...);
test("shows the open requests per working group", ...);
test("requests of two organizations show the organization next to each working group; requests of one do not", ...);
test("choosing a row opens the modal and puts the request in the address", ...);
test("opening the address with ?request opens the same modal, and only GET requests were made", ...);
test("the modal has Keur goed and Wijs af and no Annuleer", ...);
test("the cross, Escape and a click beside it close the modal, clear the address and decide nothing", ...);
test("Keur goed approves, closes, clears the address and shows the toast with name and working group", ...);
test("Wijs af rejects at once and shows its toast", ...);
test("a request that was decided in the meantime shows no modal and the toast Deze aanmelding is al behandeld.", ...);
test("an id the user may not see shows no modal and the toast Deze aanmelding bestaat niet meer.", ...);
test("a decision that answers already_decided closes the modal with the toast", ...);
test("a membership-requests-changed event takes a decided request out of the list", ...);
test("a membership-requests-changed event while a modal is open keeps the modal of a request that is still open, and closes the modal of a request that is gone with the toast Deze aanmelding is al behandeld.", ...);
test("a volunteer who opens /membership-requests sees the not-found page", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and look.** `pnpm check && pnpm build`. Then `pnpm dev`, log in on the portal as `beheerder@example.test`, open the seeded request of `aanmelder@example.test`, close it without deciding, open it again and approve. Save a screenshot of the modal to `.context/request-modal.png`.
- [ ] **Step 5: Commit.** `git commit -m "Add the membership requests page to the portal"`

---

### Task 5: One link, two places

**Files:**

- Create: `packages/ui/src/lib/is-phone.ts`, `apps/mobile/src/hooks/send-to-portal.ts`, `apps/portal/src/send-to-app.ts`
- Modify: `packages/ui/src/index.ts`, `apps/mobile/src/main.tsx`, `apps/portal/src/main.tsx`, `apps/mobile/vite.config.ts`, `apps/portal/vite.config.ts`, the `vite-env.d.ts` of both apps
- Test: `packages/ui/src/lib/is-phone.test.ts`, `apps/mobile/src/hooks/send-to-portal.test.ts`, `apps/portal/src/send-to-app.test.ts`

**Interfaces:**

- Produces (from `@padvinder/ui`): `isPhoneScreen(screen: { width: number; height: number }): boolean`: true when the shorter side of the device's screen is under 600 CSS pixels. It reads the screen, not the window, so a narrow browser window on a laptop is not a phone.
- Produces:
  - `portalAddressFor(location: { pathname: string }, phone: boolean): string | null` in the app: on a screen that is not a phone, `/app/more/membership-requests` gives `/membership-requests` and `/app/more/membership-requests/{id}` gives `/membership-requests?request={id}`; everything else, and every address on a phone, gives `null`.
  - `appAddressFor(location: { pathname: string; search: string }, phone: boolean): string | null` in the portal: on a phone, `/membership-requests` gives `/app/more/membership-requests`, and with `?request={id}` `/app/more/membership-requests/{id}`; everything else, and every address on a larger screen, gives `null`. An `id` that is not a UUID is left out.
  - Each app's `main.tsx` calls its function before it renders anything, so the forwarding happens before any login; with an address it replaces the location (no entry in the history) and does not render.
  - In a build both apps share one origin, so the address is used as it is. Under the dev servers the other app runs on another port of the same host: each Vite config defines the other app's dev port (`__PORTAL_DEV_PORT__`, `__APP_DEV_PORT__`, `null` in a build), and the forwarding puts it in the address.

- [ ] **Step 1: Write the failing tests.**

```ts
test.each([[{ width: 412, height: 915 }, true], [{ width: 915, height: 412 }, true], [{ width: 768, height: 1024 }, false], [{ width: 1280, height: 800 }, false]])("isPhoneScreen(%j) is %j", ...);
test.each([
  ["/app/more/membership-requests/0192f3c0-0000-7000-8000-0000000000d1", false, "/membership-requests?request=0192f3c0-0000-7000-8000-0000000000d1"],
  ["/app/more/membership-requests", false, "/membership-requests"],
  ["/app/more/membership-requests/0192f3c0-0000-7000-8000-0000000000d1", true, null],
  ["/app/more/members", false, null],
  ["/app/", false, null],
])("portalAddressFor(%j, phone %j) is %j", ...);
test.each([
  ["/membership-requests", "?request=0192f3c0-0000-7000-8000-0000000000d1", true, "/app/more/membership-requests/0192f3c0-0000-7000-8000-0000000000d1"],
  ["/membership-requests", "", true, "/app/more/membership-requests"],
  ["/membership-requests", "?request=../../x", true, "/app/more/membership-requests"],
  ["/membership-requests", "?request=0192f3c0-0000-7000-8000-0000000000d1", false, null],
  ["/working-groups", "", true, null],
])("appAddressFor(%j, %j, phone %j) is %j", ...);
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `pnpm check && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Send a request link to the app on a phone and to the portal on a laptop"`

---

### Task 6: End-to-end tests and documentation

**Files:**

- Create: `e2e/portal-membership-requests.spec.ts`
- Modify: `e2e/joining.spec.ts` (only if the new test shares its helper that reads the link from the request mail), `e2e/helpers/mailpit.ts` (only if a helper is missing), `AGENTS.md`, `infra/alwaysdata/README.md`, `scripts/lib/ci-jobs.ts` and its test (only if needed: a path no rule names already runs `e2e` and `release`)

**Interfaces:**

- Consumes: `newAddress`, `createSession`, `runAdmin`, `createWorkingGroup`, `makeVolunteer`, `readMail`; the Playwright projects `portal` (laptop-sized) and `chromium` (phone-sized).

- [ ] **Step 1: Write the tests.**

```ts
// portal-membership-requests.spec.ts
test("the link from the request mail opens the portal's modal on a laptop, and deciding takes a button", async ({ page, context }) => {
  // An applicant asks for the group (as joining.spec.ts does). The coordinator's mail has the link …/app/more/membership-requests/{id}.
  // Opened in the laptop-sized browser, not logged in: the address becomes …/membership-requests?request={id} on the portal and the login shows.
  // After logging in the modal shows the applicant; the request is still pending. Escape closes it; the request is still pending.
  // Opened again and Keur goed: the toast "… is toegelaten tot …" shows and the list is empty.
});
test("the same link stays in the app on a phone", ...);
// a phone-sized context: the request screen of the app shows, with Keur goed and Wijs af
test("the portal's requests page sends a phone to the app", ...);
```

- [ ] **Step 2: Run.** `pnpm test:e2e` three times. Expected: PASS each time.
- [ ] **Step 3: Update `AGENTS.md`.**
  - Current state: the requests page `/membership-requests` with its modal, and the app's address for a request sending a tablet or laptop on to it; what is left of this part, with adding people while `2026-11-25-adding-people.md` is not merged.
  - Frontend: `isPhoneScreen` and the forwarding between app and portal, done before the login.
- [ ] **Step 4: Update `infra/alwaysdata/README.md`.** "Verification": a new row, open: what an iPhone and an Android phone do with the link in the request mail (installed app or browser).
- [ ] **Step 5: Check the CI rules,** then run everything: `pnpm check && pnpm build && pnpm test:e2e && pnpm test:visual:docker`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Add end-to-end tests for requests in the portal, and document the forwarding"`
