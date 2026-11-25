import { mockFetch } from "@padvinder/api-client/testing";
import {
  applicantMeFixture,
  coordinatorMeFixture,
  managedWorkingGroupsFixture,
  membersWithContactFixture,
  platformAdminMeFixture,
} from "@padvinder/contracts/fixtures";
import type { MeResponse } from "@padvinder/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";
import {
  emitAccessChanged,
  errorResponse,
  holdRequests,
  neverAnswer,
  recordRequests,
  requestsTo,
} from "../testing/requests";

const noord = managedWorkingGroupsFixture[0]!;
const buitengebied = managedWorkingGroupsFixture[2]!;
const [anna, bram, cigdem, nieuw] = membersWithContactFixture as [
  (typeof membersWithContactFixture)[number],
  (typeof membersWithContactFixture)[number],
  (typeof membersWithContactFixture)[number],
  (typeof membersWithContactFixture)[number],
];

/** An admin of Paddentrek Voorbeeldstad, without a membership. */
const adminMe: MeResponse = { ...applicantMeFixture, organizationAdminOf: [noord.organization] };

const noordPath = `/working-groups/${noord.id}`;
const membersPath = `/api/working-groups/${noord.id}/members`;
const connection = "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";

function routesFor(me: MeResponse, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "/api/me": me,
    "GET /api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
    [`GET ${membersPath}`]: { members: membersWithContactFixture },
    ...extra,
  };
}

async function openMenu(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: `Acties voor ${name}` }));
}

async function choose(item: string) {
  await userEvent.click(await screen.findByRole("menuitem", { name: item }));
}

async function expectNotFound() {
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
}

test("a coordinator sees the members, no Wijzig, and a menu on volunteers only", async () => {
  mockFetch(
    routesFor(coordinatorMeFixture, {
      "GET /api/managed-working-groups": { workingGroups: [noord] },
    }),
  );
  renderPortal(noordPath);
  expect(await screen.findByRole("heading", { level: 1, name: "Noord" })).toBeVisible();
  expect(screen.getByText("Voorbeeldstad · Paddentrek Voorbeeldstad")).toBeVisible();
  expect(screen.queryByText("Deze werkgroep staat uit.")).toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "Leden" })).toBeVisible();
  expect(await screen.findByText("Anna de Vries")).toBeVisible();
  expect(screen.getByText("(nog niet ingelogd)")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Wijzig" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Zet uit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Acties voor Anna de Vries" })).toBeNull();
  expect(screen.getByRole("button", { name: "Acties voor Çiğdem Yıldız" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Acties voor (nog niet ingelogd)" })).toBeVisible();
  await openMenu("Bram Jansen");
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Verwijder uit werkgroep",
  ]);
});

test("while the members load, the page says so", async () => {
  mockFetch(routesFor(adminMe));
  neverAnswer((request) => request.url.endsWith(membersPath));
  renderPortal(noordPath);
  expect(await screen.findByText("Leden laden…")).toBeVisible();
  expect(screen.getByRole("heading", { level: 1, name: "Noord" })).toBeVisible();
});

test("a failed load of the members says so and Probeer opnieuw loads again", async () => {
  const routes = routesFor(adminMe, {
    [`GET ${membersPath}`]: new Response("boom", { status: 500 }),
  });
  mockFetch(routes);
  renderPortal(noordPath);
  expect(await screen.findByText(connection)).toBeVisible();
  routes[`GET ${membersPath}`] = { members: membersWithContactFixture };
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(await screen.findByText("Anna de Vries")).toBeVisible();
});

test("an address of a group that is not in the list shows the not-found page", async () => {
  const { calls } = mockFetch(routesFor(adminMe));
  renderPortal("/working-groups/0192f3c0-0000-7000-8000-0000000000ff");
  await expectNotFound();
  expect(calls.some((call) => call.endsWith("/members"))).toBe(false);
});

test("an admin makes a member coordinator and takes it away again, each with its toast", async () => {
  const requests = recordRequests();
  mockFetch(
    routesFor(adminMe, {
      [`PATCH /api/memberships/${bram.membershipId}`]: { ...bram, isCoordinator: true },
      [`PATCH /api/memberships/${anna.membershipId}`]: { ...anna, isCoordinator: false },
    }),
  );
  renderPortal(noordPath);
  await openMenu("Bram Jansen");
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "Maak coördinator",
    "Verwijder uit werkgroep",
  ]);
  await choose("Maak coördinator");
  expect(await screen.findByText("Bram Jansen is nu coördinator van Noord.")).toBeVisible();
  // It does not ask first.
  expect(screen.queryByRole("alertdialog")).toBeNull();

  await openMenu("Anna de Vries");
  await choose("Niet langer coördinator");
  expect(
    await screen.findByText("Anna de Vries is geen coördinator meer van Noord."),
  ).toBeVisible();
  expect(requestsTo(requests, "PATCH", "/api/memberships")).toEqual([
    {
      method: "PATCH",
      path: `/api/memberships/${bram.membershipId}`,
      body: { isCoordinator: true },
    },
    {
      method: "PATCH",
      path: `/api/memberships/${anna.membershipId}`,
      body: { isCoordinator: false },
    },
  ]);
});

test("a member without a name is Deze persoon in the toast", async () => {
  mockFetch(
    routesFor(adminMe, {
      [`PATCH /api/memberships/${nieuw.membershipId}`]: { ...nieuw, isCoordinator: true },
    }),
  );
  renderPortal(noordPath);
  await openMenu("(nog niet ingelogd)");
  await choose("Maak coördinator");
  expect(await screen.findByText("Deze persoon is nu coördinator van Noord.")).toBeVisible();
});

test("taking it from the last coordinator shows the text for last_coordinator as a toast", async () => {
  mockFetch(
    routesFor(adminMe, {
      [`PATCH /api/memberships/${anna.membershipId}`]: errorResponse(409, "last_coordinator"),
    }),
  );
  renderPortal(noordPath);
  await openMenu("Anna de Vries");
  await choose("Niet langer coördinator");
  expect(
    await screen.findByText(
      "Een werkgroep heeft altijd een coördinator. Maak eerst iemand anders coördinator.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/is geen coördinator meer/)).toBeNull();
});

test("Wijzig sends only what changed and shows the toast; an unchanged form sends nothing", async () => {
  const requests = recordRequests();
  const renamed = { ...noord, name: "Noord-West" };
  const routes = routesFor(adminMe, { [`PATCH /api/working-groups/${noord.id}`]: renamed });
  mockFetch(routes);
  renderPortal(noordPath);
  await userEvent.click(await screen.findByRole("button", { name: "Wijzig" }));
  let dialog = await screen.findByRole("dialog", { name: "Werkgroep wijzigen" });
  expect(within(dialog).getByLabelText("Naam")).toHaveValue("Noord");
  expect(within(dialog).getByLabelText("Plaats")).toHaveValue("Voorbeeldstad");
  expect(within(dialog).queryByLabelText("E-mailadres van de coördinator")).toBeNull();
  // The same values in another shape are no change.
  await userEvent.clear(within(dialog).getByLabelText("Plaats"));
  await userEvent.type(within(dialog).getByLabelText("Plaats"), "  Voorbeeldstad ");
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requestsTo(requests, "PATCH", "/api/working-groups")).toEqual([]);
  expect(screen.queryByText(/is gewijzigd/)).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Wijzig" }));
  dialog = await screen.findByRole("dialog", { name: "Werkgroep wijzigen" });
  await userEvent.clear(within(dialog).getByLabelText("Naam"));
  await userEvent.type(within(dialog).getByLabelText("Naam"), "Noord-West");
  routes["GET /api/managed-working-groups"] = {
    workingGroups: [renamed, ...managedWorkingGroupsFixture.slice(1)],
  };
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Werkgroep Noord-West is gewijzigd.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requestsTo(requests, "PATCH", "/api/working-groups")).toEqual([
    { method: "PATCH", path: `/api/working-groups/${noord.id}`, body: { name: "Noord-West" } },
  ]);
  expect(await screen.findByRole("heading", { level: 1, name: "Noord-West" })).toBeVisible();
});

test("a taken name keeps the edit open with the text under Naam", async () => {
  mockFetch(
    routesFor(adminMe, {
      [`PATCH /api/working-groups/${noord.id}`]: errorResponse(409, "name_taken", [
        { path: "name", message: "x" },
      ]),
    }),
  );
  renderPortal(noordPath);
  await userEvent.click(await screen.findByRole("button", { name: "Wijzig" }));
  const dialog = await screen.findByRole("dialog", { name: "Werkgroep wijzigen" });
  await userEvent.clear(within(dialog).getByLabelText("Naam"));
  await userEvent.type(within(dialog).getByLabelText("Naam"), "Zuid-Oost");
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await within(dialog).findByText("Er is al een werkgroep met deze naam.")).toBeVisible();
  expect(screen.getByRole("dialog", { name: "Werkgroep wijzigen" })).toBeVisible();
});

test("Zet uit asks first; confirming sends active false", async () => {
  const requests = recordRequests();
  const routes = routesFor(adminMe, {
    [`PATCH /api/working-groups/${noord.id}`]: { ...noord, active: false },
  });
  mockFetch(routes);
  renderPortal(noordPath);
  await userEvent.click(await screen.findByRole("button", { name: "Zet uit" }));
  let dialog = await screen.findByRole("alertdialog", { name: "Werkgroep Noord uitzetten?" });
  expect(
    within(dialog).getByText("De leden zien deze werkgroep dan niet meer in de app."),
  ).toBeVisible();
  await userEvent.click(within(dialog).getByRole("button", { name: "Annuleer" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(requestsTo(requests, "PATCH", "/api/working-groups")).toEqual([]);

  await userEvent.click(screen.getByRole("button", { name: "Zet uit" }));
  dialog = await screen.findByRole("alertdialog", { name: "Werkgroep Noord uitzetten?" });
  routes["GET /api/managed-working-groups"] = {
    workingGroups: [{ ...noord, active: false }, ...managedWorkingGroupsFixture.slice(1)],
  };
  await userEvent.click(within(dialog).getByRole("button", { name: "Zet uit" }));
  expect(await screen.findByText("Werkgroep Noord staat uit.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(requestsTo(requests, "PATCH", "/api/working-groups")).toEqual([
    { method: "PATCH", path: `/api/working-groups/${noord.id}`, body: { active: false } },
  ]);
  // An admin keeps the group in the list: the page stays and says it is off.
  expect(await screen.findByText("Deze werkgroep staat uit.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Zet aan" })).toBeVisible();
});

test("while Zet uit runs, Escape does not close the question; a failure shows in it after", async () => {
  mockFetch(
    routesFor(adminMe, {
      [`PATCH /api/working-groups/${noord.id}`]: new Response("boom", { status: 502 }),
    }),
  );
  const release = holdRequests((request) => request.method === "PATCH");
  renderPortal(noordPath);
  await userEvent.click(await screen.findByRole("button", { name: "Zet uit" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Werkgroep Noord uitzetten?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Zet uit" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Even geduld…" })).toBeVisible(),
  );
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("alertdialog", { name: "Werkgroep Noord uitzetten?" })).toBeVisible();
  release();
  expect(await within(dialog).findByText(connection)).toBeVisible();
});

test("Zet aan does not ask and shows its toast", async () => {
  const requests = recordRequests();
  mockFetch(
    routesFor(platformAdminMeFixture, {
      [`GET /api/working-groups/${buitengebied.id}/members`]: { members: [] },
      [`PATCH /api/working-groups/${buitengebied.id}`]: { ...buitengebied, active: true },
    }),
  );
  renderPortal(`/working-groups/${buitengebied.id}`);
  expect(await screen.findByText("Deze werkgroep staat uit.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Zet aan" }));
  expect(await screen.findByText("Werkgroep Buitengebied staat aan.")).toBeVisible();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(requestsTo(requests, "PATCH", "/api/working-groups")).toEqual([
    { method: "PATCH", path: `/api/working-groups/${buitengebied.id}`, body: { active: true } },
  ]);
});

test("Zet aan on a group without a coordinator shows the text for no_coordinator", async () => {
  mockFetch(
    routesFor(platformAdminMeFixture, {
      [`GET /api/working-groups/${buitengebied.id}/members`]: { members: [] },
      [`PATCH /api/working-groups/${buitengebied.id}`]: errorResponse(409, "no_coordinator"),
    }),
  );
  renderPortal(`/working-groups/${buitengebied.id}`);
  await userEvent.click(await screen.findByRole("button", { name: "Zet aan" }));
  expect(
    await screen.findByText(
      "Deze werkgroep heeft geen coördinator. Maak eerst iemand coördinator.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/staat aan\./)).toBeNull();
});

test("removing a member asks first and shows the toast", async () => {
  const requests = recordRequests();
  mockFetch(
    routesFor(coordinatorMeFixture, {
      "GET /api/managed-working-groups": { workingGroups: [noord] },
      [`DELETE /api/memberships/${bram.membershipId}`]: new Response(null, { status: 204 }),
    }),
  );
  renderPortal(noordPath);
  await openMenu("Bram Jansen");
  await choose("Verwijder uit werkgroep");
  let dialog = await screen.findByRole("alertdialog", {
    name: "Bram Jansen verwijderen uit Noord?",
  });
  expect(within(dialog).getByText("Bram Jansen kan zich daarna opnieuw aanmelden.")).toBeVisible();
  await userEvent.click(within(dialog).getByRole("button", { name: "Annuleer" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(requestsTo(requests, "DELETE", "/api/memberships")).toEqual([]);

  await openMenu("Bram Jansen");
  await choose("Verwijder uit werkgroep");
  dialog = await screen.findByRole("alertdialog", { name: "Bram Jansen verwijderen uit Noord?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder" }));
  expect(await screen.findByText("Bram Jansen is verwijderd uit Noord.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(requestsTo(requests, "DELETE", "/api/memberships")).toEqual([
    { method: "DELETE", path: `/api/memberships/${bram.membershipId}`, body: undefined },
  ]);
});

test("a removal that fails shows its text in the question", async () => {
  mockFetch(
    routesFor(adminMe, {
      [`DELETE /api/memberships/${cigdem.membershipId}`]: errorResponse(409, "membership_changed"),
    }),
  );
  renderPortal(noordPath);
  await openMenu("Çiğdem Yıldız");
  await choose("Verwijder uit werkgroep");
  const dialog = await screen.findByRole("alertdialog", {
    name: "Çiğdem Yıldız verwijderen uit Noord?",
  });
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder" }));
  expect(
    await within(dialog).findByText("Deze persoon heeft intussen een andere rol. Kijk opnieuw."),
  ).toBeVisible();
  expect(screen.queryByText(/is verwijderd uit/)).toBeNull();
});

test("when the group leaves the list while its page is open, the page turns into not found", async () => {
  const routes = routesFor(coordinatorMeFixture, {
    "GET /api/managed-working-groups": { workingGroups: [noord] },
  });
  mockFetch(routes);
  renderPortal(noordPath);
  expect(await screen.findByRole("heading", { level: 1, name: "Noord" })).toBeVisible();
  // The group was switched off: a coordinator no longer manages it.
  routes["GET /api/managed-working-groups"] = { workingGroups: [] };
  emitAccessChanged(coordinatorMeFixture.user.id);
  await expectNotFound();
  expect(screen.queryByRole("heading", { name: "Noord" })).toBeNull();
});
