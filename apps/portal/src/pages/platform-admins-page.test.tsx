import { mockFetch } from "@padvinder/api-client/testing";
import {
  meFixture,
  platformAdminMeFixture,
  platformAdminsFixture,
} from "@padvinder/contracts/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";
import {
  answerRequests,
  errorResponse,
  holdRequests,
  neverAnswer,
  recordRequestAddresses,
  recordRequests,
  requestsTo,
} from "../testing/requests";

const listPath = "/api/platform-admins";
const [newAdmin, ownRow, pieter] = platformAdminsFixture as [
  (typeof platformAdminsFixture)[number],
  (typeof platformAdminsFixture)[number],
  (typeof platformAdminsFixture)[number],
];
const list = { platformAdmins: platformAdminsFixture };
const connection = "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";
const confirmText = (address: string) =>
  `Je maakt ${address} hoofdbeheerder. Controleer het adres: wie hiermee inlogt, kan alles inzien en wijzigen.`;

function routesFor(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { "/api/me": platformAdminMeFixture, [`GET ${listPath}`]: list, ...extra };
}

async function openAdd() {
  await userEvent.click(await screen.findByRole("button", { name: "Voeg hoofdbeheerder toe" }));
  return screen.findByRole("dialog", { name: "Hoofdbeheerder toevoegen" });
}

async function continueWith(dialog: HTMLElement, address: string) {
  await userEvent.type(within(dialog).getByLabelText("E-mailadres"), address);
  await userEvent.click(within(dialog).getByRole("button", { name: "Ga verder" }));
}

async function askRemove(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: `Acties voor ${name}` }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Verwijder als hoofdbeheerder" }),
  );
  return screen.findByRole("alertdialog");
}

test("shows the platform admins, one of them as (nog niet ingelogd)", async () => {
  mockFetch(routesFor());
  renderPortal("/platform-admins");
  expect(await screen.findByRole("heading", { level: 1, name: "Hoofdbeheerders" })).toBeVisible();
  expect(
    screen.getByText("Een hoofdbeheerder kan alles inzien en wijzigen, in alle organisaties."),
  ).toBeVisible();
  expect(await screen.findByRole("cell", { name: /^\(nog niet ingelogd\)/ })).toBeVisible();
  expect(screen.getByRole("cell", { name: ownRow.name })).toBeVisible();
  expect(screen.getByRole("cell", { name: pieter.name })).toBeVisible();
  expect(screen.getByRole("link", { name: newAdmin.email })).toBeVisible();
});

test("while the list loads the page says so", async () => {
  mockFetch(routesFor());
  neverAnswer((request) => new URL(request.url).pathname === listPath);
  renderPortal("/platform-admins");
  expect(await screen.findByText("Hoofdbeheerders laden…")).toBeVisible();
});

test("a failed load shows the connection text, and Probeer opnieuw loads again", async () => {
  const routes = routesFor({ [`GET ${listPath}`]: new Response("boom", { status: 500 }) });
  mockFetch(routes);
  renderPortal("/platform-admins");
  expect(await screen.findByText(connection)).toBeVisible();
  routes[`GET ${listPath}`] = list;
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(await screen.findByRole("cell", { name: pieter.name })).toBeVisible();
});

test("Ga verder sends nothing; the second step shows the address; Maak hoofdbeheerder posts it and shows the toast", async () => {
  const requests = recordRequests();
  const addresses = recordRequestAddresses();
  mockFetch(routesFor({ [`POST ${listPath}`]: list }));
  renderPortal("/platform-admins");
  const dialog = await openAdd();
  expect(
    within(dialog).getByText("Heeft deze persoon nog geen account? Dan wordt het aangemaakt."),
  ).toBeVisible();
  await continueWith(dialog, "  Extra@Example.test ");
  expect(await within(dialog).findByText(confirmText("extra@example.test"))).toBeVisible();
  expect(within(dialog).queryByRole("button", { name: "Ga verder" })).toBeNull();
  expect(requestsTo(requests, "POST", listPath)).toEqual([]);
  await userEvent.click(within(dialog).getByRole("button", { name: "Maak hoofdbeheerder" }));
  expect(await screen.findByText("extra@example.test is hoofdbeheerder.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requestsTo(requests, "POST", listPath)).toEqual([
    { method: "POST", path: listPath, body: { email: "extra@example.test" } },
  ]);
  // The address goes in the body only, never in a path or a query.
  expect(addresses.length).toBeGreaterThan(0);
  for (const address of addresses) expect(address).not.toContain("@");
});

test("Terug returns to the field with the address still in it, and nothing was sent", async () => {
  const requests = recordRequests();
  mockFetch(routesFor({ [`POST ${listPath}`]: list }));
  renderPortal("/platform-admins");
  const dialog = await openAdd();
  await continueWith(dialog, "extra@example.test");
  await userEvent.click(await within(dialog).findByRole("button", { name: "Terug" }));
  expect(within(dialog).getByLabelText("E-mailadres")).toHaveValue("extra@example.test");
  expect(within(dialog).getByRole("button", { name: "Ga verder" })).toBeVisible();
  expect(within(dialog).queryByText(confirmText("extra@example.test"))).toBeNull();
  expect(requestsTo(requests, "POST", listPath)).toEqual([]);
});

test("'jan@' shows Vul een geldig e-mailadres in. and does not reach the second step", async () => {
  const requests = recordRequests();
  mockFetch(routesFor());
  renderPortal("/platform-admins");
  const dialog = await openAdd();
  await continueWith(dialog, "jan@");
  expect(await within(dialog).findByText("Vul een geldig e-mailadres in.")).toBeVisible();
  expect(within(dialog).queryByRole("button", { name: "Maak hoofdbeheerder" })).toBeNull();
  expect(requestsTo(requests, "POST", listPath)).toEqual([]);
});

test("an address the server refuses goes back to the field with the text under it", async () => {
  mockFetch(
    routesFor({
      [`POST ${listPath}`]: errorResponse(400, "invalid_request", [
        { path: "email", message: "x" },
      ]),
    }),
  );
  renderPortal("/platform-admins");
  const dialog = await openAdd();
  await continueWith(dialog, "extra@example.test");
  await userEvent.click(await within(dialog).findByRole("button", { name: "Maak hoofdbeheerder" }));
  expect(await within(dialog).findByText("Vul een geldig e-mailadres in.")).toBeVisible();
  expect(within(dialog).getByLabelText("E-mailadres")).toHaveValue("extra@example.test");
  expect(within(dialog).getByRole("button", { name: "Ga verder" })).toBeVisible();
});

test("any other failure shows its text above the buttons of the second step", async () => {
  mockFetch(routesFor({ [`POST ${listPath}`]: errorResponse(403, "not_allowed") }));
  renderPortal("/platform-admins");
  const dialog = await openAdd();
  await continueWith(dialog, "extra@example.test");
  await userEvent.click(await within(dialog).findByRole("button", { name: "Maak hoofdbeheerder" }));
  expect(await within(dialog).findByText("Dit mag je niet doen.")).toBeVisible();
  expect(within(dialog).getByText(confirmText("extra@example.test"))).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Maak hoofdbeheerder" })).toBeVisible();
});

test("the modal cannot be closed while the appointment runs", async () => {
  mockFetch(routesFor({ [`POST ${listPath}`]: list }));
  const release = holdRequests((request) => request.method === "POST");
  renderPortal("/platform-admins");
  const dialog = await openAdd();
  await continueWith(dialog, "extra@example.test");
  await userEvent.click(await within(dialog).findByRole("button", { name: "Maak hoofdbeheerder" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Even geduld…" })).toBeDisabled(),
  );
  expect(within(dialog).getByRole("button", { name: "Terug" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(dialog).getByRole("button", { name: "Sluiten" }));
  expect(screen.getByRole("dialog", { name: "Hoofdbeheerder toevoegen" })).toBeVisible();
  release();
  expect(await screen.findByText("extra@example.test is hoofdbeheerder.")).toBeVisible();
});

test("a reopened modal starts at an empty field", async () => {
  mockFetch(routesFor());
  renderPortal("/platform-admins");
  let dialog = await openAdd();
  await continueWith(dialog, "extra@example.test");
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  dialog = await openAdd();
  expect(within(dialog).getByLabelText("E-mailadres")).toHaveValue("");
  expect(within(dialog).getByRole("button", { name: "Ga verder" })).toBeVisible();
});

test("removing asks first, and the toast names the person", async () => {
  const requests = recordRequests();
  mockFetch(
    routesFor({ [`DELETE ${listPath}/${pieter.userId}`]: new Response(null, { status: 204 }) }),
  );
  renderPortal("/platform-admins");
  const confirm = await askRemove(pieter.name);
  expect(within(confirm).getByText(`${pieter.name} verwijderen als hoofdbeheerder?`)).toBeVisible();
  expect(
    within(confirm).getByText(`${pieter.name} kan PadVinder dan niet meer beheren.`),
  ).toBeVisible();
  expect(requestsTo(requests, "DELETE", listPath)).toEqual([]);
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder" }));
  expect(await screen.findByText(`${pieter.name} is geen hoofdbeheerder meer.`)).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(requestsTo(requests, "DELETE", listPath)).toEqual([
    { method: "DELETE", path: `${listPath}/${pieter.userId}`, body: undefined },
  ]);
});

test("removing someone without a name names them by address", async () => {
  mockFetch(
    routesFor({ [`DELETE ${listPath}/${newAdmin.userId}`]: new Response(null, { status: 204 }) }),
  );
  renderPortal("/platform-admins");
  const confirm = await askRemove(newAdmin.email);
  expect(
    within(confirm).getByText(`${newAdmin.email} verwijderen als hoofdbeheerder?`),
  ).toBeVisible();
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder" }));
  expect(await screen.findByText(`${newAdmin.email} is geen hoofdbeheerder meer.`)).toBeVisible();
});

test("removing yourself asks Jezelf verwijderen als hoofdbeheerder? and the page turns into the not-found page", async () => {
  const routes = routesFor();
  mockFetch(routes);
  answerRequests(
    (url, request) =>
      request.method === "DELETE" && url.pathname === `${listPath}/${ownRow.userId}`,
    () => {
      // The server took the flag: me says so from now on.
      routes["/api/me"] = meFixture;
      return new Response(null, { status: 204 });
    },
  );
  renderPortal("/platform-admins");
  const confirm = await askRemove(ownRow.name);
  expect(within(confirm).getByText("Jezelf verwijderen als hoofdbeheerder?")).toBeVisible();
  expect(within(confirm).getByText("Je kunt PadVinder dan niet meer beheren.")).toBeVisible();
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder" }));
  expect(await screen.findByText("Je bent geen hoofdbeheerder meer.")).toBeVisible();
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Hoofdbeheerders" })).toBeNull();
});

test("a 409 last_platform_admin shows Er moet een hoofdbeheerder blijven die al eens is ingelogd. in the dialog, and the row stays", async () => {
  mockFetch(
    routesFor({
      [`DELETE ${listPath}/${ownRow.userId}`]: errorResponse(409, "last_platform_admin"),
    }),
  );
  renderPortal("/platform-admins");
  const confirm = await askRemove(ownRow.name);
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder" }));
  expect(
    await within(confirm).findByText("Er moet een hoofdbeheerder blijven die al eens is ingelogd."),
  ).toBeVisible();
  expect(screen.queryByText(/geen hoofdbeheerder meer/)).toBeNull();
  await userEvent.click(within(confirm).getByRole("button", { name: "Annuleer" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByRole("cell", { name: ownRow.name })).toBeVisible();
});

test("any other failure of removing shows its text in the dialog", async () => {
  mockFetch(
    routesFor({ [`DELETE ${listPath}/${pieter.userId}`]: errorResponse(404, "not_found") }),
  );
  renderPortal("/platform-admins");
  const confirm = await askRemove(pieter.name);
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder" }));
  expect(await within(confirm).findByText("Dit bestaat niet meer.")).toBeVisible();
});

test("the question cannot be closed while the removal runs", async () => {
  mockFetch(
    routesFor({ [`DELETE ${listPath}/${pieter.userId}`]: new Response(null, { status: 204 }) }),
  );
  const release = holdRequests((request) => request.method === "DELETE");
  renderPortal("/platform-admins");
  const confirm = await askRemove(pieter.name);
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder" }));
  await waitFor(() =>
    expect(within(confirm).getByRole("button", { name: "Even geduld…" })).toBeDisabled(),
  );
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("alertdialog")).toBeVisible();
  release();
  expect(await screen.findByText(`${pieter.name} is geen hoofdbeheerder meer.`)).toBeVisible();
});
