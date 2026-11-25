import { mockFetch } from "@padvinder/api-client/testing";
import {
  applicantMeFixture,
  coordinatorMeFixture,
  managedWorkingGroupsFixture,
  organizationDetailFixture,
  organizationsFixture,
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

const voorbeeldstad = organizationsFixture[1]!;
const pagePath = `/organizations/${voorbeeldstad.id}`;
const path = `/api${pagePath}`;
const [firstAdmin, secondAdmin] = organizationDetailFixture.admins as [
  (typeof organizationDetailFixture.admins)[number],
  (typeof organizationDetailFixture.admins)[number],
];
const adminMe: MeResponse = { ...applicantMeFixture, organizationAdminOf: [voorbeeldstad] };
const baseRoutes = {
  "/api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
};
const adminPath = `${path}/admins`;

async function expectNotFound() {
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
}

test("the page shows the name, the contact address, the admins and this organization's groups only", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    [path]: organizationDetailFixture,
    ...baseRoutes,
  });
  renderPortal(pagePath);
  expect(await screen.findByRole("heading", { level: 1, name: voorbeeldstad.name })).toBeVisible();
  expect(screen.getByText("Contactadres: contact@example.test")).toBeVisible();
  expect(screen.getByRole("heading", { level: 2, name: "Beheerders" })).toBeVisible();
  expect(screen.getByRole("cell", { name: firstAdmin.name })).toBeVisible();
  expect(screen.getByRole("heading", { level: 2, name: "Werkgroepen" })).toBeVisible();
  const noord = await screen.findByRole("link", { name: "Noord" });
  expect(noord).toHaveAttribute("href", `/working-groups/${managedWorkingGroupsFixture[0]!.id}`);
  expect(screen.getByRole("link", { name: "Zuid-Oost" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Buitengebied" })).toBeNull();
});

test("without a contact address the page says so; without groups it says that too", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    [path]: { ...organizationDetailFixture, contactEmail: null },
    "/api/managed-working-groups": { workingGroups: [] },
  });
  renderPortal(pagePath);
  expect(await screen.findByText("Geen contactadres")).toBeVisible();
  expect(await screen.findByText("Deze organisatie heeft nog geen werkgroepen.")).toBeVisible();
});

test("while the organization loads the page says so, and a failed load offers Probeer opnieuw", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture });
  neverAnswer((request) => request.url.endsWith(path));
  renderPortal(pagePath);
  expect(await screen.findByText("Organisatie laden…")).toBeVisible();
});

test("a failed load says so and Probeer opnieuw loads again", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    [path]: new Response("boom", { status: 500 }),
    ...baseRoutes,
  };
  mockFetch(routes);
  renderPortal(pagePath);
  expect(
    await screen.findByText("Het lukt nu niet. Controleer je verbinding en probeer het opnieuw."),
  ).toBeVisible();
  routes[path] = organizationDetailFixture;
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(await screen.findByRole("heading", { level: 1, name: voorbeeldstad.name })).toBeVisible();
});

test("a coordinator who opens an organization's page sees the not-found page", async () => {
  const { calls } = mockFetch({
    "/api/me": coordinatorMeFixture,
    [path]: errorResponse(404, "not_found"),
  });
  renderPortal(pagePath);
  await expectNotFound();
  expect(calls).not.toContain(path);
});

test("an organization the API does not know shows the not-found page", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture, [path]: errorResponse(404, "not_found") });
  renderPortal(pagePath);
  await expectNotFound();
});

test("when the organization answers 404 while its page is open, the page turns into not found", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    [path]: organizationDetailFixture,
    ...baseRoutes,
  };
  mockFetch(routes);
  renderPortal(pagePath);
  expect(await screen.findByRole("heading", { level: 1, name: voorbeeldstad.name })).toBeVisible();
  routes[path] = errorResponse(404, "not_found");
  emitAccessChanged(platformAdminMeFixture.user.id);
  await expectNotFound();
});

test("an admin changes the contact address and cannot change the name", async () => {
  const requests = recordRequests();
  const routes: Record<string, unknown> = {
    "/api/me": adminMe,
    [`GET ${path}`]: organizationDetailFixture,
    [`PATCH ${path}`]: { ...organizationDetailFixture, contactEmail: "nieuw@example.test" },
    ...baseRoutes,
  };
  mockFetch(routes);
  renderPortal(pagePath);
  await userEvent.click(await screen.findByRole("button", { name: "Wijzig" }));
  const dialog = await screen.findByRole("dialog", { name: "Organisatie wijzigen" });
  expect(within(dialog).queryByRole("textbox", { name: "Naam" })).toBeNull();
  const contact = within(dialog).getByLabelText("Contactadres");
  await userEvent.clear(contact);
  await userEvent.type(contact, " Nieuw@example.test ");
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText(`Organisatie ${voorbeeldstad.name} is gewijzigd.`)).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requestsTo(requests, "PATCH", "/api/organizations")).toEqual([
    { method: "PATCH", path, body: { contactEmail: "Nieuw@example.test" } },
  ]);
});

test("saving without a change closes without a request or a toast; emptying the address sends null", async () => {
  const requests = recordRequests();
  mockFetch({
    "/api/me": platformAdminMeFixture,
    [`GET ${path}`]: organizationDetailFixture,
    [`PATCH ${path}`]: { ...organizationDetailFixture, contactEmail: null },
    ...baseRoutes,
  });
  renderPortal(pagePath);
  await userEvent.click(await screen.findByRole("button", { name: "Wijzig" }));
  let dialog = await screen.findByRole("dialog", { name: "Organisatie wijzigen" });
  // Same name with extra spaces and the address in capitals: not a change.
  const name = within(dialog).getByLabelText("Naam");
  await userEvent.clear(name);
  await userEvent.type(name, `  ${voorbeeldstad.name.replace(" ", "  ")} `);
  const contact = within(dialog).getByLabelText("Contactadres");
  await userEvent.clear(contact);
  await userEvent.type(contact, "CONTACT@example.test");
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByText(/is gewijzigd/)).toBeNull();
  expect(requestsTo(requests, "PATCH", "/api/organizations")).toEqual([]);

  await userEvent.click(screen.getByRole("button", { name: "Wijzig" }));
  dialog = await screen.findByRole("dialog", { name: "Organisatie wijzigen" });
  await userEvent.clear(within(dialog).getByLabelText("Contactadres"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText(`Organisatie ${voorbeeldstad.name} is gewijzigd.`)).toBeVisible();
  expect(requestsTo(requests, "PATCH", "/api/organizations")[0]!.body).toEqual({
    contactEmail: null,
  });
});

test("a platform admin renames it, and a taken name shows under Naam", async () => {
  const requests = recordRequests();
  const routes: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    [`GET ${path}`]: organizationDetailFixture,
    [`PATCH ${path}`]: errorResponse(409, "name_taken", [{ path: "name", message: "x" }]),
    ...baseRoutes,
  };
  mockFetch(routes);
  renderPortal(pagePath);
  await userEvent.click(await screen.findByRole("button", { name: "Wijzig" }));
  const dialog = await screen.findByRole("dialog", { name: "Organisatie wijzigen" });
  const name = within(dialog).getByLabelText("Naam");
  await userEvent.clear(name);
  await userEvent.type(name, "Padden Nieuw");
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await within(dialog).findByText("Er is al een organisatie met deze naam.")).toBeVisible();
  routes[`PATCH ${path}`] = { ...organizationDetailFixture, name: "Padden Nieuw" };
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Organisatie Padden Nieuw is gewijzigd.")).toBeVisible();
  expect(requestsTo(requests, "PATCH", "/api/organizations").map((r) => r.body)).toEqual([
    { name: "Padden Nieuw" },
    { name: "Padden Nieuw" },
  ]);
});

test("while the change is saved, Escape does not close the modal", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    [`GET ${path}`]: organizationDetailFixture,
    [`PATCH ${path}`]: organizationDetailFixture,
    ...baseRoutes,
  });
  const release = holdRequests((request) => request.method === "PATCH");
  renderPortal(pagePath);
  await userEvent.click(await screen.findByRole("button", { name: "Wijzig" }));
  const dialog = await screen.findByRole("dialog", { name: "Organisatie wijzigen" });
  await userEvent.clear(within(dialog).getByLabelText("Contactadres"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Even geduld…" })).toBeVisible(),
  );
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Organisatie wijzigen" })).toBeVisible();
  release();
  expect(await screen.findByText(`Organisatie ${voorbeeldstad.name} is gewijzigd.`)).toBeVisible();
});

test("an admin sees the admins without a menu and without Voeg beheerder toe", async () => {
  mockFetch({ "/api/me": adminMe, [path]: organizationDetailFixture, ...baseRoutes });
  renderPortal(pagePath);
  expect(await screen.findByRole("cell", { name: firstAdmin.name })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Voeg beheerder toe" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Acties voor/ })).toBeNull();
});

test("a platform admin adds an admin by address and removes one after confirming", async () => {
  const requests = recordRequests();
  const routes: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    [`GET ${path}`]: organizationDetailFixture,
    [`POST ${adminPath}`]: Response.json(organizationDetailFixture, { status: 201 }),
    [`DELETE ${adminPath}/${firstAdmin.userId}`]: new Response(null, { status: 204 }),
    ...baseRoutes,
  };
  mockFetch(routes);
  renderPortal(pagePath);
  await userEvent.click(await screen.findByRole("button", { name: "Voeg beheerder toe" }));
  const add = await screen.findByRole("dialog", { name: "Beheerder toevoegen" });
  expect(
    within(add).getByText("Heeft deze persoon nog geen account? Dan wordt het aangemaakt."),
  ).toBeVisible();
  await userEvent.type(within(add).getByLabelText("E-mailadres"), "extra@example.test");
  await userEvent.click(within(add).getByRole("button", { name: "Voeg toe" }));
  expect(
    await screen.findByText(`extra@example.test is beheerder van ${voorbeeldstad.name}.`),
  ).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requestsTo(requests, "POST", "/api/organizations")).toEqual([
    { method: "POST", path: adminPath, body: { email: "extra@example.test" } },
  ]);

  await userEvent.click(screen.getByRole("button", { name: `Acties voor ${firstAdmin.name}` }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Verwijder als beheerder" }));
  const confirm = await screen.findByRole("alertdialog");
  expect(
    within(confirm).getByText(
      `${firstAdmin.name} verwijderen als beheerder van ${voorbeeldstad.name}?`,
    ),
  ).toBeVisible();
  expect(
    within(confirm).getByText(
      `${firstAdmin.name} kan ${voorbeeldstad.name} dan niet meer beheren.`,
    ),
  ).toBeVisible();
  expect(requestsTo(requests, "DELETE", "/api/organizations")).toEqual([]);
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder" }));
  expect(
    await screen.findByText(`${firstAdmin.name} is geen beheerder meer van ${voorbeeldstad.name}.`),
  ).toBeVisible();
  expect(requestsTo(requests, "DELETE", "/api/organizations")).toHaveLength(1);
});

test("an address the server refuses shows under the field", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    [`GET ${path}`]: organizationDetailFixture,
    [`POST ${adminPath}`]: errorResponse(400, "invalid_request", [{ path: "email", message: "x" }]),
    ...baseRoutes,
  });
  renderPortal(pagePath);
  await userEvent.click(await screen.findByRole("button", { name: "Voeg beheerder toe" }));
  const add = await screen.findByRole("dialog", { name: "Beheerder toevoegen" });
  await userEvent.type(within(add).getByLabelText("E-mailadres"), "extra@example.test");
  await userEvent.click(within(add).getByRole("button", { name: "Voeg toe" }));
  expect(await within(add).findByText("Vul een geldig e-mailadres in.")).toBeVisible();
  expect(screen.getByRole("dialog", { name: "Beheerder toevoegen" })).toBeVisible();
});

test("removing the last admin shows the text for last_organization_admin in the dialog", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    [`GET ${path}`]: organizationDetailFixture,
    [`DELETE ${adminPath}/${secondAdmin.userId}`]: errorResponse(409, "last_organization_admin"),
    ...baseRoutes,
  });
  renderPortal(pagePath);
  await screen.findByRole("cell", { name: firstAdmin.name });
  await userEvent.click(screen.getAllByRole("button", { name: /Acties voor/ })[1]!);
  await userEvent.click(await screen.findByRole("menuitem", { name: "Verwijder als beheerder" }));
  const confirm = await screen.findByRole("alertdialog");
  // A person who never logged in has no name: the text says "Deze persoon".
  expect(
    within(confirm).getByText(`Deze persoon verwijderen als beheerder van ${voorbeeldstad.name}?`),
  ).toBeVisible();
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder" }));
  expect(
    await within(confirm).findByText(
      "Een organisatie heeft altijd een beheerder. Maak eerst iemand anders beheerder.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/is geen beheerder meer/)).toBeNull();
});

test("Nieuwe werkgroep opens the form for this organization", async () => {
  const requests = recordRequests();
  const noord = managedWorkingGroupsFixture[0]!;
  mockFetch({
    "/api/me": adminMe,
    [path]: organizationDetailFixture,
    [`POST ${path}/working-groups`]: Response.json(noord, { status: 201 }),
    [`/api/working-groups/${noord.id}/members`]: { members: [] },
    ...baseRoutes,
  });
  const { router } = renderPortal(pagePath);
  await userEvent.click(await screen.findByRole("button", { name: "Nieuwe werkgroep" }));
  const dialog = await screen.findByRole("dialog", { name: "Nieuwe werkgroep" });
  await userEvent.type(within(dialog).getByLabelText("Naam"), "Noord");
  await userEvent.type(within(dialog).getByLabelText("Plaats"), "Voorbeeldstad");
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Werkgroep Noord is toegevoegd.")).toBeVisible();
  expect(requestsTo(requests, "POST", "/api/organizations")[0]!.path).toBe(
    `${path}/working-groups`,
  );
  expect(router.state.location.pathname).toBe(`/working-groups/${noord.id}`);
});
