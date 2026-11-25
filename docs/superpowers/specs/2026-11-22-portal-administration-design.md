# Portal administration (slice 1, part 2)

Date: 22 November 2026. Status: approved by the maintainer on 22 November 2026.

## Intent

Part 1 of slice 1 ("Accounts and access", `2026-11-21-accounts-and-access-design.md`) gives PadVinder login, roles, permissions and the audit log, with a command-line tool for administration. This part moves administration into the portal, so that a coordinator or an admin can run PadVinder without the command line or the database. The project plan's bar for v1 is that an admin manages users and species "zonder databasehandwerk".

It also solves a problem the plan does not mention: in January 2027 the existing volunteers of Paddentrek Enschede all have to get in. Letting each of them sign up and wait for approval would put every coordinator through dozens of approvals. So coordinators and admins can add people by email address.

The plan warns that drain monitoring and a full CMS together are too large for v1, and says to keep the CMS to what v1 needs. This design follows that: it holds what must exist before the first drain check, and names what waits.

## Goals

- A platform admin creates organizations and appoints their admins. An organization admin creates and edits working groups and appoints coordinators.
- A coordinator or admin adds people to a working group by email address, one at a time or as a pasted list. Each added person gets a mail.
- A coordinator handles membership requests from the one button in the mail: in the portal on a laptop, in the app on a phone.
- One official species list for all organizations, managed by platform admins, present in every environment from the first deploy.
- An organization admin and a platform admin can read the audit log.
- A platform admin can delete an account when the person asks for it.

## Non-goals

- Texts, help texts, FAQ, colors and general settings; whether admins can edit mail texts.
- Drain types (slice 3), safety test versions (slice 2), the WhatsApp links (slice 5), transects (slice 3).
- Reports, exports and public pages.
- Species picked per organization, pictures of species, and conservation statuses (see "Follow-ups").
- "Other animals" such as a dead mouse as structured data (see "Follow-ups").
- Changing someone's email address.
- A stronger login for admins. The plan still owes it, and it matters more now that the portal carries admin power (see "Open questions").
- A view over all people of an organization or of the platform. People are reached through their working group.

## Anti-goals

What would make this a failure even if it works:

- An organization admin sees or changes anything of another organization, or a coordinator anything of another working group.
- Adding someone by email address shows the adder a name or phone number that person never chose to share with them.
- An organization without an admin, or an active working group without a coordinator, so that requests and mails go nowhere.
- Opening a link changes something. Every change needs a deliberate tap on a button, also when the link comes from our own mail.
- A control that is only hidden in the portal while the API would still accept the call.
- Adding people becomes a way to send mail to strangers: no limit on how many addresses one account can add.
- A burst of a hundred mails that gets the sender marked as spam in the week everyone logs in for the first time.
- A species is deleted or silently turned into another species, so that earlier counts change their meaning.
- Personal data in the audit log, in the mail queue or in server logs.

## Constraints

All of AGENTS.md and the design of part 1 apply. The ones that shape this work most:

- Routes reach the user through `request.actor` and decide through the permission module. 401 without a login, 404 for what the actor may not see at all, 403 for what they may see but not change.
- A `GET` never changes state.
- A change, its audit entry and its live events go in one transaction. The audit log never holds a name, an email address or a phone number.
- `PATCH` takes a partial object: absent keys stay, `null` empties, unknown keys are rejected.
- Content that an admin should be able to change is managed in the portal, not in code. The first five species are the one deliberate exception (see "Species").
- The API and the worker talk only through PostgreSQL.
- URL paths are English; everything a user reads is Dutch, with "je".
- The mobile app is phone only. The portal is made for a laptop, with one exception below.

## Approaches

Decided with the maintainer on 22 November 2026.

**One species list or several.** Considered:

1. _One list for all organizations, managed by platform admins_ (chosen). Counts from different organizations add up, and an export to RAVON maps one to one. An organization that misses a species asks a platform admin.
2. _One shared list, with each organization picking what its volunteers see._ Can be added on top later, when the count screen is designed (slice 6).
3. _A list per organization._ Rejected: numbers across organizations no longer add up.

**How the first species reach staging and production.** Considered:

1. _The migration that creates the table also inserts them_ (chosen). Every environment starts with the same five, with the same IDs, and nothing has to be typed in before January.
2. _A platform admin types them in per environment._ Keeps all content out of code, at the cost of a manual step that is easy to forget.

**How existing volunteers get in.** Considered:

1. _A coordinator or admin adds people by email address_ (chosen). The membership exists at once; the person logs in with a code and lands in the app.
2. _Everyone signs up and is approved._ Nothing to build, but every coordinator approves their whole group one by one.

**How a coordinator decides a request from the mail.** Considered:

1. _One button in the mail opens the list of requests with a modal for that request; the modal has "Keur goed" and "Wijs af"_ (chosen). The link is the app's address for the request: a phone stays in the app, a laptop is sent on to the portal's modal.
2. _Two buttons in the mail that decide when the page opens._ Rejected: the app makes the request's ID, so an applicant knows their own and could send the coordinator a link that approves it. Browsers also load pages ahead of time. And AGENTS.md forbids a change by link.
3. _A page per request._ Not needed next to the list.

**Adding someone who already uses PadVinder.** Adding makes a membership at once, and a membership shows the coordinator the person's name and phone number. So a coordinator who knows a volunteer's email address could read their phone number by adding them. Considered:

1. _Only an address that has never been used is added at once; someone with a profile has to ask for the group themselves_ (chosen). Someone who never logged in has nothing to reveal, and that is nearly everyone in January. It needs no new kind of record.
2. _An invitation the person accepts in the app._ One tap for them, but a new kind of record and new screens.
3. _Accept it,_ with the mail to the person and the audit entry as the only brakes. Rejected: it breaks part 1's rule on who sees contact details.

**How an added person finds out.** Considered:

1. _PadVinder mails them_ (chosen). New volunteers may not be in WhatsApp and may not want to be. If mail lands in spam, that problem has to be solved anyway, since login depends on it.
2. _The portal shows a text for the coordinator to paste into WhatsApp._ Rejected for the reason above.

**How the screens are built.** Considered:

1. _Ordinary portal pages on the generated client, with shared components in `packages/ui`_ (chosen). The same pattern as everything else.
2. _An admin framework such as React Admin or Refine._ Faster list-and-edit screens, but it brings its own data layer, routing and look, which fights the generated client and shadcn/ui.

**Where the endpoints live.** The same kind of endpoints as part 1, behind the same permission module, shared by app and portal (chosen). A separate `/api/admin/` area does not fit: permissions here are per working group and per organization, not per area.

## Design

### Who may do what

The table of part 1 stays. This part adds:

| Action                                                                  | Volunteer | Coordinator of the group | Admin of the organization | Platform admin |
| ----------------------------------------------------------------------- | --------- | ------------------------ | ------------------------- | -------------- |
| Read the species list                                                   | yes       | yes                      | yes                       | yes            |
| Add people to the group by email address                                | no        | yes                      | yes                       | yes            |
| Make a member coordinator, or take that away again                      | no        | no                       | yes                       | yes            |
| Create a working group; change its name or city; switch it off or on    | no        | no                       | yes                       | yes            |
| See the organization's page; change its contact email address           | no        | no                       | yes                       | yes            |
| Read the audit log of the organization                                  | no        | no                       | yes                       | yes            |
| Create or rename an organization; appoint or remove organization admins | no        | no                       | no                        | yes            |
| Add, change, switch off a species                                       | no        | no                       | no                        | yes            |
| Make or unmake a platform admin                                         | no        | no                       | no                        | yes            |
| Read the whole audit log                                                | no        | no                       | no                        | yes            |
| Delete someone else's account                                           | no        | no                       | no                        | yes            |

A coordinator cannot appoint a second coordinator; the organization's admin does that. An organization admin cannot appoint another organization admin; a platform admin does. These follow the project plan ("Toegewezen per werkgroep", "Aangewezen door de hoofdbeheerder").

The permission module gets these actions, and a second kind of target next to the working group: the organization. Someone with no admin row for an organization gets 404 on its page and its audit log, also when they are a member of one of its working groups.

### Data model

| Change                              | Detail                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New table `species`                 | `id`, `dutch_name`, `scientific_name`, `needs_verification` (default false), `active` (default true), `created_at`, `updated_at`. Not scoped by organization, by design |
| `organizations.contact_email`       | Nullable. The address people are told to write to when something is wrong                                                                                               |
| `organizations.name` becomes unique | Ignoring capital letters, so a double submit cannot make the same organization twice                                                                                    |
| `users.last_login_at`               | Nullable. Set at every successful login. For accounts that exist when the migration runs, filled from their newest session                                              |

No table for the mail queue: pg-boss holds the jobs (see "The mail queue").

### Species

A species record holds a Dutch name, a scientific name, whether it needs the check for rare species (the "betrouwbaarheidscheck" of slice 8; nothing reads it yet), and whether it is active.

- **Both names are unique,** ignoring capital letters and surrounding spaces. The scientific name is what an export matches on; the Dutch name is what a volunteer sees on a button. An entry for a group, such as an unidentified frog, uses the group's scientific name.
- **Names are stored as typed,** apart from surrounding and doubled spaces. The form asks to write a name as in a sentence ("gewone pad"), but it does not lower the capitals itself: a name such as "Italiaanse kamsalamander" needs one. Screens show the Dutch name with a capital where it stands alone. Two names that differ only in capitals or spacing are the same name. _(Changed on 22 November 2026 while planning; the first version stored Dutch names in lower case.)_
- **Lists sort by Dutch name,** in Dutch order. There is no position field.
- **A species is never deleted.** Counts will point at it. It is switched off, which hides it from input and keeps everything recorded.
- **A name may be changed to fix a mistake,** and the audit entry keeps the old and the new value. The form says: "Wijzig een naam alleen om een fout te herstellen. Voeg voor een andere soort een nieuwe soort toe."

The migration that creates the table inserts these five, with fixed IDs that are the same in every environment. After that, the list changes only through the portal; the migration is never edited.

| Dutch name             | Scientific name                    | Needs the check |
| ---------------------- | ---------------------------------- | --------------- |
| bruine kikker          | _Rana temporaria_                  | no              |
| gewone pad             | _Bufo bufo_                        | no              |
| groene kikker          | _Pelophylax esculentus_ synklepton | no              |
| kamsalamander          | _Triturus cristatus_               | yes             |
| kleine watersalamander | _Lissotriton vulgaris_             | no              |

The list comes from the working group's own records (Paddenobservaties.xlsx, checked by the maintainer on 22 November 2026). "Groene kikker" is a group of three kinds that cannot be told apart in the field at night (poelkikker, meerkikker and their hybrid, bastaardkikker); RAVON writes the group as _Pelophylax esculentus_ synklepton. Only kamsalamander gets the check, following the plan's own example; an ecologist should confirm that.

Because the migration inserts them, the seed adds no species, and test databases have the five as well.

### Organizations and working groups

- **An organization** has a name and a contact email address. A platform admin creates it and can rename it; the organization's admin can change the contact address. Its page lists its admins and links to its working groups.
- **A working group** has a name, a city and an active flag. The organization's admin creates it and changes it.
- **An organization always has at least one admin, and an active working group at least one coordinator** (the maintainer's rule), so a request or a mail always reaches someone.
  - Creating an organization asks for the email address of its first admin; creating a working group asks for the email address of its first coordinator. Both are required, and both are made in the same transaction as the organization or group. The coordinator field starts with the creator's own address.
  - The first coordinator can be an address that has never been used, the creator, or someone who is already in a working group of this organization. For someone with a profile elsewhere the form says: "Deze persoon heeft al een account buiten {organisatie}. Kies iemand anders of word eerst zelf coördinator." This is the same protection as in "Adding by email address".
  - The last admin of an organization cannot be removed, and the last coordinator of an active working group cannot be removed from the group or lose the role: 409, with "Een organisatie heeft altijd een beheerder. Maak eerst iemand anders beheerder." or "Een werkgroep heeft altijd een coördinator. Maak eerst iemand anders coördinator."
  - **This changes a rule of part 1:** someone who is the last coordinator of an active group, or the last admin of an organization, cannot delete their account until someone else is appointed. The app says: "Je bent de enige coördinator van {werkgroep}. Vraag {contactadres van de organisatie} om eerst iemand anders coördinator te maken." (and the same for "beheerder van {organisatie}"). The same holds when a platform admin deletes the account for them. _(Author's call; the alternative is to let the account go and fall back on the organization's admins, as part 1 did.)_
  - Part 1's fallback stays as a safety net: a request for a group without a coordinator is mailed to the organization's admins.
  - The seed and the test cast are changed to follow the rule. Organizations and groups that were made with the command-line tool before this part get their admin and coordinator from the maintainer, with the tool, before this part is deployed.
- **Switching off a working group** hides it from the list people choose from and from its members' apps (part 1 already leaves inactive groups out of a user's access). Nothing is deleted, and switching it on brings everything back; switching on needs a coordinator. A member whose only group is switched off sees the "Kies je werkgroep" screen. The portal asks first: "Werkgroep {naam} uitzetten? De leden zien deze werkgroep dan niet meer in de app." Every member's app is told through the `access-changed` event.
- **Organizations are not switched off or deleted** in this part.

### People

**Adding by email address.** On a working group's page, "Voeg mensen toe" opens a field for one address or a pasted list, one address per line.

The form checks the shape of every address while the list is typed or pasted, before anything is sent: it names each line that is not an email address ("Regel 3: 'jan@' is geen geldig e-mailadres.") and keeps the button disabled until all lines are right. The API checks again with the same rule, which lives once in `packages/contracts`. Neither checks whether the address exists.

The portal sends the whole list in one request, and the API handles the addresses one by one, each in its own transaction, so one bad address does not undo the rest:

- An address is trimmed and lowercased; doubles in the list count once. What is not an email address, or ends in `@deleted.invalid`, is answered with "geen geldig e-mailadres".
- No account yet: one is made, with an empty name. The person gives their name at first login, as in part 1.
- Already a member of this group: answered with "is al lid", nothing changes.
- An account that has logged in before (`last_login_at` is set), with an open request for this group: the request becomes approved, decided by whoever added them. They asked for it. The answer is "is toegelaten", and they get the approval mail of part 1.
- Such an account without an open request for this group: **not added.** The answer is "heeft al een account en krijgt een mail". The person gets a mail that says how to ask for the group themselves (see "Mails"), and an audit entry `membership.invited` is written. A second attempt for the same person and group within 24 hours sends no second mail.
- Otherwise (no account, or an account that has never logged in): a membership as a volunteer, an audit entry, the `access-changed` event, and a queued mail.

The portal thereby tells the adder that an address has a PadVinder account, though not where. That is accepted.

The answer lists each address with its outcome, and the portal shows that list. Sending the same list twice adds nobody twice and mails nobody twice.

Limits, so this cannot be used to mail strangers in bulk: at most 200 addresses per request, and at most 500 people added or invited per account per 24 hours. More answers 429. _(Numbers are the author's call.)_

**Asking for another working group in the app.** Part 1 left this out; this part needs it. The Profiel screen in the app gets "Meld je aan bij nog een werkgroep", which opens part 1's list of working groups without the groups the person is already in or has asked for. A request made there works like any other. While it is open, Profiel shows "Je aanmelding bij {werkgroep} wacht op goedkeuring." with "Trek aanmelding in".

**Who has logged in.** Whether someone has ever logged in comes from `last_login_at`, never from the name being empty. Member lists show "(nog niet ingelogd)" in place of the name for an account that never logged in, and "(nog geen naam)" for someone who logged in but has not given a name yet. The same field decides whether an address counts as never used, above and under "Removing".

**Roles.** Every member is a volunteer; a coordinator is a volunteer who also coordinates. In the members table a coordinator's name is bold, with "Coördinator" below it. Each row ends with a menu (three dots). For the organization's admin it holds "Maak coördinator", or for a coordinator "Niet langer coördinator"; for everyone who may, it holds "Verwijder uit werkgroep". There are no buttons in the row itself: these are rare actions. The visual design is improved later.

On the organization's page, a platform admin adds an organization admin by email address (the account is made when there is none) and removes one. A page "Hoofdbeheerders" does the same for platform admins; the last one cannot be removed, as in part 1.

**Removing.** "Verwijder uit werkgroep" works as in part 1, with one addition: when the removed person has never logged in and is left with no membership, no admin row and no open request, their account is deleted too (the same soft delete). An address that was added with a typing mistake therefore does not stay behind. _(Author's call.)_

**Deleting an account for someone.** A platform admin has a page "Account verwijderen": enter an email address, see whose account it is (name and working groups, or "Geen account met dit adres."), and confirm with "Account van {naam} verwijderen? Dit kun je niet terugdraaien." It does the same soft delete as the person's own button in the app. It works for any account, also one without a membership, such as an applicant or a removed member. It is for requests from people who cannot or will not do it themselves. _(Author's call.)_

### Membership requests in the portal

One page, `/membership-requests`, lists the open requests of every working group the user reviews, grouped by working group, with the applicant's name and the date.

- Choosing a row puts the request in the address (`?request=<id>`) and opens a modal on top of the list: name, email address, phone number, date, working group, and two buttons, "Keur goed" and "Wijs af". There is no "Annuleer" next to "Wijs af", which would confuse; the modal closes without deciding through the cross in its corner, the Escape key, or a click beside it.
- Opening the page with `?request=<id>` in the address opens the same modal. **Nothing is decided until a button is pressed.**
- After a decision the modal closes, the address loses the request, and a toast says "{naam} is toegelaten tot {werkgroep}." or "De aanmelding van {naam} is afgewezen."
- A request that was decided or withdrawn in the meantime, or an ID the user may not see: no modal, and a toast "Deze aanmelding is al behandeld." or "Deze aanmelding bestaat niet meer."
- The list follows the `membership-requests-changed` event, like the app.

**One link, two places** (decided 22 November 2026). The button in the mail carries the app's address for the request, `/app/more/membership-requests/<id>`, as in part 1. Where it ends depends on the device, and the forwarding happens before any login:

- **On a phone** it stays in the app, on part 1's screen for the request, so a coordinator can approve on the road.
- **On a tablet or a laptop** the app's address sends the browser on to the portal: `/membership-requests?request=<id>`, with the modal.
- The other way round, the portal's `/membership-requests` opened on a phone sends the browser to the app's list or request screen.

Why the app's address and not the portal's: on Android an installed app opens straight from the mail only when the link belongs to the app. On an iPhone a link from a mail opens Safari, not the installed app, and nothing a website does can change that; Safari has its own login, so the coordinator logs in there once. Since iOS 26 Safari is reported to sometimes offer "Open in …" for a link that belongs to an installed web app; an app address gives it that chance. What an iPhone really does with this link is added to the checks on real phones. The dependable way into the installed app on an iPhone is a push notification, which part 3 brings.

### Mails

**Every mail starts with a greeting:** "Hallo {naam}," when the receiver's name is known, otherwise "Hallo,", then an empty line. This holds for the mails below and for the four of part 1 (login code, new request, approved, rejected). It is built once, in `packages/mail`, in pull request 3 of this part, where all mail texts move anyway. In the login code mail the rule "no digit besides the code" stays: a name that contains a digit gets "Hallo,". Whether the greeting above the code line disturbs a phone's code detection is added to the checks on real phones.

On staging the subject of every mail, also of the queued ones the worker sends, starts with `[STAGING] ` (part 1's design, "The mails"; added 25 November 2026). The mailer in `packages/mail` adds it, in the API and in the worker.

The examples below leave the greeting and that prefix out.

**New request** (changes part 1's mail). One button, "Bekijk aanmelding", to the app's address for the request (see "One link, two places"):

```
Onderwerp: Nieuwe aanmelding bij {werkgroep}

{naam} wil meedoen met werkgroep {werkgroep}.

Bekijk de aanmelding:
{link}

Je vindt de aanmelding ook in de app, onder Meer > Aanmeldingen.
```

**Added to a working group** (new), to every address that was added:

```
Onderwerp: Je bent toegevoegd aan werkgroep {werkgroep}

{naam van wie je toevoegde} heeft je toegevoegd aan werkgroep {werkgroep} in PadVinder.

Open PadVinder en log in met dit e-mailadres:
{link naar de app}

Klopt dit niet? Neem contact op met {contactadres van de organisatie}.
```

The last sentence is left out when the organization has no contact address. When the account of whoever added them is gone by the time the mail is sent, the first sentence is "Je bent toegevoegd aan werkgroep {werkgroep} in PadVinder." For the first coordinator of a new working group, when that is not the creator, the first sentence is "{naam} heeft je coördinator gemaakt van werkgroep {werkgroep} in PadVinder." and the link goes to the portal.

**Invited to ask for a working group** (new), to someone who already has a profile:

```
Onderwerp: {naam van wie je wilde toevoegen} wil je toevoegen aan werkgroep {werkgroep}

{naam van wie je wilde toevoegen} wil je toevoegen aan werkgroep {werkgroep} in PadVinder.

Wil je dat? Open PadVinder, ga naar Meer > Profiel en kies "Meld je aan bij nog een werkgroep".
{link naar de app}

Wil je dat niet? Dan hoef je niets te doen.
```

**Appointed as organization admin** (new) _(author's call)_:

```
Onderwerp: Je bent beheerder van {organisatie}

Je bent beheerder van {organisatie} in PadVinder.

Open het portaal en log in met dit e-mailadres:
{link naar het portaal}
```

Making an existing member coordinator, or someone platform admin, sends no mail: the person who does it tells them.

Only the portal's endpoints queue these mails. The command-line tool, the seed and the test helpers call the same functions in `packages/db` and send nothing: whoever uses the tool tells the person. _(Author's call.)_

### The mail queue

The three new mails go through the worker; the login code, the request mail and the decision mails keep leaving the API directly, because someone is waiting for them.

- The API queues a job in pg-boss in the same transaction as the change, so a mail is queued exactly when the change was committed. If pg-boss cannot join the transaction, the job is queued right after the commit; the builder checks which.
- A job holds IDs only (which kind of mail, and which membership, admin row, or person and working group). The worker loads the address and the names when it sends, so the queue holds no personal data. A mail whose person or membership is gone by then is dropped.
- The worker sends one mail at a time with at least 2 seconds between them, so a pasted list does not leave as a burst. A failed send is retried 5 times with growing pauses, then logged (without address or name) and dropped. _(Numbers are the author's call.)_
- The mailer, the HTML helpers and the mail texts move from `apps/api` to a shared package, `packages/mail`, used by the API and the worker. The worker gets the SMTP settings and `PUBLIC_ORIGIN`.
- Part 3 (push) builds its notification pipeline on this queue.

### The audit log

New actions, all written in the transaction of the change:

| Action                                    | Written when                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `membership.added`                        | Someone adds a person to a group                                                        |
| `membership.invited`                      | Someone tried to add a person who already has a profile; that person was mailed instead |
| `working_group.updated`                   | Name or city changed (details: which fields, old and new values)                        |
| `working_group.deactivated`, `.activated` | Switched off or on                                                                      |
| `organization.updated`                    | Name or contact address changed (the contact address itself is not stored)              |
| `species.created`, `.updated`             | With old and new values                                                                 |
| `species.deactivated`, `.activated`       | Switched off or on                                                                      |
| `account.deleted`                         | Now also by a platform admin, who is then the actor                                     |
| The role actions of part 1                | Now also from the portal, with the user as actor                                        |

**Reading it.** One page, newest first, 50 entries at a time with "Laad meer", and filters on organization (platform admins) and on kind of action.

- An organization's admin sees the entries of their organization. Entries without an organization (platform admins, species, deleted accounts) are for platform admins only.
- Each entry is shown as when, who, and one Dutch sentence per action, such as "Aanmelding goedgekeurd: {naam} bij {werkgroep}" or "Soort gewijzigd: {oude naam} wordt {nieuwe naam}".
- The log stores IDs; the page fills in names when it is shown, by the rule on who sees names. A platform admin sees every name. An organization's admin sees the current name of a person who is connected to their organization now (a membership, an open request or an admin row), "Voormalig lid" for a person who no longer is, and "Verwijderd account" for a deleted one. The command-line tool shows as "Systeem".

### The portal

Navigation, each item only for who may use it:

| Item                | Path                   | For                                                               |
| ------------------- | ---------------------- | ----------------------------------------------------------------- |
| Werkgroepen         | `/working-groups`      | Coordinators (their groups), organization admins, platform admins |
| Aanmeldingen        | `/membership-requests` | The same, with the number of open requests                        |
| Organisatie(s)      | `/organizations`       | Organization admins (straight to their own), platform admins      |
| Soorten             | `/species`             | Platform admins                                                   |
| Logboek             | `/audit-log`           | Organization admins, platform admins                              |
| Hoofdbeheerders     | `/platform-admins`     | Platform admins                                                   |
| Account verwijderen | `/delete-account`      | Platform admins                                                   |
| Systeemstatus       | `/system`              | Platform admins                                                   |

A working group's page is `/working-groups/{id}`, an organization's `/organizations/{id}`.

- **Werkgroepen** is a table: name, city, organization (when more than one is visible), number of members, open requests, and whether it is active. "Nieuwe werkgroep" for those who may, with the fields "Naam", "Plaats" and "E-mailadres van de coördinator". "Nieuwe organisatie" on the organizations page has "Naam", "Contactadres" and "E-mailadres van de beheerder".
- **A working group's page** shows its details with "Wijzig" and "Zet uit" or "Zet aan", and the members: name (see "Roles"), email address, phone number, and the menu.
- **Soorten** is a table sorted by Dutch name: "Nederlandse naam", "Wetenschappelijke naam" (in italics), "Betrouwbaarheidscheck" (ja or nee), "Actief". "Nieuwe soort" and "Wijzig" open a form; switching off asks "{naam} uitzetten? Vrijwilligers kunnen deze soort dan niet meer kiezen. Eerdere tellingen blijven bewaard."
- **Someone who manages nothing** (a volunteer) sees, after logging in: "Het portaal is voor coördinatoren en beheerders. Tellen doe je in de app.", a link "Open de app" and "Log uit".
- Results of actions show as toasts. Errors use the Dutch text for the API's error `code`, as in part 1.
- Hiding an item is for convenience only; the API decides. A page opened by address by someone who may not see it shows the "not found" text.
- Laptop first. On a phone `/membership-requests` leads to the app; the other pages must not break there. The app stays phone only: its request screens send a tablet or laptop to the portal.

### API

Under `/api`, in `packages/contracts`. Paths and field names are the builder's to refine; the behavior is fixed.

| Endpoint                                                      | Does                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /species`                                                | All species with their `active` flag, for every logged-in user                                                                             |
| `POST /species`, `PATCH /species/{id}`                        | Create; change names, the check, or `active`. 409 when a name is taken                                                                     |
| `GET /managed-working-groups`                                 | The groups the actor reviews or administers, also inactive ones, with member and open request counts                                       |
| `POST /organizations/{id}/working-groups`                     | Create a group with its first coordinator (`coordinatorEmail`)                                                                             |
| `PATCH /working-groups/{id}`                                  | Change name, city or `active`                                                                                                              |
| `POST /working-groups/{id}/members`                           | Add people: `{ emails: string[] }`, answers one outcome per address: added, approved, invited, already a member, or not an address         |
| `PATCH /memberships/{id}`                                     | Set or clear `isCoordinator`. 409 for the last coordinator of an active group                                                              |
| `GET /membership-requests`                                    | The open requests of every group the actor reviews                                                                                         |
| `GET /organizations`, `GET /organizations/{id}`               | The organizations the actor administers; one with its admins                                                                               |
| `POST /organizations`, `PATCH /organizations/{id}`            | Create with its first admin (`adminEmail`); change name (platform admin) or contact address. An organization admin sending `name` gets 403 |
| `POST /organizations/{id}/admins`, `DELETE …/admins/{userId}` | Appoint by email address; remove (never the last)                                                                                          |
| `GET /platform-admins`, `POST …`, `DELETE …/{userId}`         | List, appoint by email address, remove (never the last)                                                                                    |
| `GET /audit-log-entries`                                      | A page of entries, with filters and names filled in as described                                                                           |
| `GET /users?email=…`                                          | Look up one account by its exact email address (platform admin): id, name, working groups; 404 when none                                   |
| `DELETE /users/{id}`                                          | Delete someone's account (platform admin)                                                                                                  |

Creating things from the portal uses IDs made by the server: these are not writes from the field. A second submit of the same form is caught by the unique names (organization, working group within its organization, species) and answers 409.

The member list of part 1 gains `hasLoggedIn` for those who may see contact details. Removing a membership and deleting an account answer 409 where the rule on the last coordinator or admin forbids it.

### The command-line tool

It stays, for making the first platform admin and for emergencies. `create-organization` requires `--admin-email` and takes an optional `--contact-email`; `create-working-group` requires `--coordinator-email`. The revoke commands refuse the last admin of an organization and the last coordinator of an active group. It sends no mail.

### Tests

As AGENTS.md and part 1 require. The parts that need care:

- **Every new endpoint has its `expectStatuses` test** with the standard cast, and a test that an organization admin of another organization gets 404.
- **Field by field:** an organization admin may change the contact address but not the name.
- **Always an admin and a coordinator:** an organization or working group cannot be created without one; the last one cannot be removed, lose the role, or delete their account, through any endpoint or the command-line tool; with a second one it works. A first coordinator with a profile outside the organization is refused.
- **The form for adding people** names each line that is not an address and does not send while one is wrong; the API refuses the same input with the same rule.
- **Who has logged in:** `last_login_at` is set by a login and not by being added; a person who logged in without giving a name is not shown as "(nog niet ingelogd)".
- **Adding people:** a list with a new address, a never-used account, a person with a profile, a person with a profile and an open request for this group, a member, a double and a non-address gives the right outcome for each; one membership and one queued mail per added person; the person with a profile gets no membership and their name and phone number appear in no answer; the same list again changes nothing and mails nobody; the 201st address and the 501st person of the day are refused.
- **Asking for another group in the app:** a member asks for a second group, sees it waiting on Profiel, and is in both after approval.
- **The mail queue:** a job holds no address and no name; the worker sends one at a time with the pause; a failing mailer is retried and finally dropped without crashing the worker; a job for a removed membership is dropped.
- **Species:** both names unique ignoring capitals; a species cannot be deleted through any endpoint; the migration gives exactly the five, also on a database that already holds part 1's data.
- **The audit log page:** an organization admin does not get entries of another organization or entries without one; names are filled in by the rule, with "Voormalig lid" and "Verwijderd account".
- **The request modal:** opening the address decides nothing (no call that changes state until a button is pressed); it has no cancel button and closes by the cross, Escape and a click beside it; a decided request shows the toast. The app's address for a request stays in the app on a phone and leads to the portal's modal on a laptop, also before login; the portal's requests page leads to the app on a phone.
- **Switching off a group:** its members' `/api/me` loses it and gets it back.
- **Removing a person who never logged in** deletes the account when nothing else points at them, and leaves it when they are in another group.
- **The lookup by email address** is for platform admins only, matches the exact address, and answers 404 for an unknown one.
- **The greeting:** every mail starts with "Hallo {naam}," or "Hallo,"; the login code mail still holds no digit besides the code.
- **Playwright:** a platform admin makes an organization and a group and adds two people with a pasted list; one of them logs in with the address from the mail and lands in the app. A coordinator opens the link from a request mail, sees the modal and approves; the link opens the portal's modal in a laptop-sized browser and the app's request screen in a phone-sized one. A platform admin adds a species. A volunteer sees the "portaal is voor coördinatoren" text.
- **Stories** for every new shared component and screen state.

## Follow-ups

Recorded here so they are not lost; none is built in this part.

- **Conservation statuses** (the Dutch Rode Lijst category, the Habitatrichtlijn annex): with the reports slice, when an ecologist says which ones they want to filter on. The yes/no for the check stays a decision of its own.
- **Species picked per organization, and pictures of species:** slice 6, with the count screen.
- **Other animals** (a dead mouse, beetles): free text is hard to analyze. Revisit when the drain check is designed (slice 4); one option is entries in this same list with a category.
- **How the NDFF names the green frog group:** check when the export to RAVON is designed.
- **Part 3 (push)** takes over the mail queue for its notifications.

## Order of work

Four pull requests, in this order, each with its own plan. All of them build on the three pull requests of part 1. The plans are written once those are open, because they name real files and helpers.

1. **Portal shell and species.** Navigation by role, the shared table, form, modal and toast, the species table with its five rows, the species endpoints and page.
2. **Organizations, working groups and roles.** The endpoints and pages, creating with a first admin or coordinator, the rule on the last one (also in part 1's account deletion, the command-line tool, the seed and the test cast), the new permission actions, the audit entries.
3. **Adding people and requests in the portal.** `last_login_at`, adding by address with its form, `packages/mail` with the greeting for all mails, the mail queue in the worker, the new mails, asking for another group in the app, the requests page with its modal and the forwarding between app and portal, the changed request mail.
4. **The audit log page, platform admins, and deleting an account for someone.**

## Left to the builder

- File and module names, the split into components, and exact API paths and field names within the behavior above.
- The fixed IDs of the five species.
- How a pg-boss job joins the API's transaction, and how job data is kept out of pg-boss's archive for longer than a day.
- The table and toast components (shadcn/ui has both).
- How a page tells a phone from a tablet or a laptop.
- Where `last_login_at` is set (Better Auth has a hook that runs when a session is made).
- The Dutch sentence for each audit action, in the style of the two examples.
- How the portal's navigation looks on a narrow screen.
- Remaining small Dutch texts, in the style of AGENTS.md.

## Open questions

None that block planning. One for the maintainer to decide before real data comes in: the portal now lets an admin delete accounts and add people, behind a login that is a code by email. The plan asks for a stronger login for admins; Better Auth has plugins for a second factor and for passkeys. It is not designed here.
