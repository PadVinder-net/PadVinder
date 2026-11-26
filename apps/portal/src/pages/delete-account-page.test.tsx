import { mockFetch } from "@padvinder/api-client/testing";
import type { AccountSummary } from "@padvinder/contracts";
import {
  accountSummaryFixture,
  accountWithoutGroupsFixture,
  platformAdminMeFixture,
} from "@padvinder/contracts/fixtures";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";
import { errorResponse, holdRequests, recordRequests, requestsTo } from "../testing/requests";

const lookupPath = "/api/users/lookup";
const sanne = accountSummaryFixture;
const deletePath = (account: AccountSummary) => `/api/users/${account.id}`;
const ownAccount: AccountSummary = {
  ...accountWithoutGroupsFixture,
  id: platformAdminMeFixture.user.id,
  name: platformAdminMeFixture.user.name,
  email: platformAdminMeFixture.user.email,
  hasLoggedIn: true,
  isPlatformAdmin: true,
};

function routesFor(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "/api/me": platformAdminMeFixture,
    // The deletion refetches the administration lists.
    "/api/platform-admins": { platformAdmins: [] },
    "/api/managed-working-groups": { workingGroups: [] },
    "/api/organizations": { organizations: [] },
    "/api/membership-requests": { requests: [] },
    ...extra,
  };
}

async function search(address: string) {
  const field = await screen.findByLabelText("E-mailadres");
  await userEvent.clear(field);
  await userEvent.type(field, address);
  await userEvent.click(screen.getByRole("button", { name: "Zoek" }));
}

async function askDelete() {
  await userEvent.click(await screen.findByRole("button", { name: "Verwijder account" }));
  return screen.findByRole("alertdialog");
}

test("the page explains itself and offers the search", async () => {
  mockFetch(routesFor());
  renderPortal("/delete-account");
  expect(
    await screen.findByRole("heading", { level: 1, name: "Account verwijderen" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Zoek het account op het e-mailadres. Dit is voor mensen die hun account niet zelf kunnen verwijderen.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Zoek" })).toBeVisible();
});

test("a search shows whose account it is, with its working groups", async () => {
  const requests = recordRequests();
  mockFetch(routesFor({ [`POST ${lookupPath}`]: sanne }));
  renderPortal("/delete-account");
  await search(sanne.email);
  expect(await screen.findByRole("heading", { level: 2, name: sanne.name })).toBeVisible();
  expect(screen.getByText(sanne.email)).toBeVisible();
  expect(screen.getByText("Noord · Paddentrek Voorbeeldstad (coördinator)")).toBeVisible();
  expect(screen.getByText("Zuid · Paddentrek Voorbeeldstad")).toBeVisible();
  expect(screen.getByRole("button", { name: "Verwijder account" })).toBeVisible();
  expect(requestsTo(requests, "POST", lookupPath)).toEqual([
    { method: "POST", path: lookupPath, body: { email: sanne.email } },
  ]);
  // The address goes in the body only, never in a path or a query.
  for (const request of requests) expect(request.path).not.toContain("@");
});

test("an unknown address shows Geen account met dit adres. and no button", async () => {
  mockFetch(routesFor({ [`POST ${lookupPath}`]: errorResponse(404, "not_found") }));
  renderPortal("/delete-account");
  await search("niemand@example.test");
  expect(await screen.findByText("Geen account met dit adres.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Verwijder account" })).toBeNull();
});

test("a new search replaces the result", async () => {
  const routes = routesFor({ [`POST ${lookupPath}`]: sanne });
  mockFetch(routes);
  renderPortal("/delete-account");
  await search(sanne.email);
  expect(await screen.findByRole("heading", { level: 2, name: sanne.name })).toBeVisible();
  routes[`POST ${lookupPath}`] = errorResponse(404, "not_found");
  await search("niemand@example.test");
  expect(await screen.findByText("Geen account met dit adres.")).toBeVisible();
  expect(screen.queryByRole("heading", { level: 2, name: sanne.name })).toBeNull();
});

test("a failed search shows the Dutch text in the form", async () => {
  mockFetch(routesFor({ [`POST ${lookupPath}`]: new Response("boom", { status: 500 }) }));
  renderPortal("/delete-account");
  await search(sanne.email);
  expect(
    await screen.findByText("Het lukt nu niet. Controleer je verbinding en probeer het opnieuw."),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
});

test("the own account shows the text for own_account and no button", async () => {
  mockFetch(routesFor({ [`POST ${lookupPath}`]: ownAccount }));
  renderPortal("/delete-account");
  await search(ownAccount.email);
  expect(
    await screen.findByText(
      "Dit is je eigen account. Dat verwijder je in de app, onder Meer > Profiel.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Verwijder account" })).toBeNull();
});

test("until Verwijder account in the dialog is pressed, only the lookup was sent", async () => {
  const requests = recordRequests();
  mockFetch(
    routesFor({
      [`POST ${lookupPath}`]: sanne,
      [`DELETE ${deletePath(sanne)}`]: new Response(null, { status: 204 }),
    }),
  );
  renderPortal("/delete-account");
  await search(sanne.email);
  const confirm = await askDelete();
  expect(within(confirm).getByText(`Account van ${sanne.name} verwijderen?`)).toBeVisible();
  expect(within(confirm).getByText("Dit kun je niet terugdraaien.")).toBeVisible();
  await userEvent.click(within(confirm).getByRole("button", { name: "Annuleer" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(requests.filter((request) => request.method !== "GET")).toEqual([
    { method: "POST", path: lookupPath, body: { email: sanne.email } },
  ]);
  expect(screen.getByRole("heading", { level: 2, name: sanne.name })).toBeVisible();
});

test("confirming deletes, shows the toast with the name, and empties the page", async () => {
  const requests = recordRequests();
  mockFetch(
    routesFor({
      [`POST ${lookupPath}`]: sanne,
      [`DELETE ${deletePath(sanne)}`]: new Response(null, { status: 204 }),
    }),
  );
  renderPortal("/delete-account");
  await search(sanne.email);
  const confirm = await askDelete();
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder account" }));
  expect(await screen.findByText(`Het account van ${sanne.name} is verwijderd.`)).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.queryByRole("heading", { level: 2, name: sanne.name })).toBeNull();
  expect(screen.getByLabelText("E-mailadres")).toHaveValue("");
  expect(requestsTo(requests, "DELETE", "/api/users")).toEqual([
    { method: "DELETE", path: deletePath(sanne), body: undefined },
  ]);
});

test("an account without a name is asked about by its address", async () => {
  const account = accountWithoutGroupsFixture;
  mockFetch(
    routesFor({
      [`POST ${lookupPath}`]: account,
      [`DELETE ${deletePath(account)}`]: new Response(null, { status: 204 }),
    }),
  );
  renderPortal("/delete-account");
  await search(account.email);
  const confirm = await askDelete();
  expect(within(confirm).getByText(`Account van ${account.email} verwijderen?`)).toBeVisible();
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder account" }));
  expect(await screen.findByText(`Het account van ${account.email} is verwijderd.`)).toBeVisible();
});

test("a blocked deletion shows who must be replaced first, in the dialog, and the account stays", async () => {
  mockFetch(
    routesFor({
      [`POST ${lookupPath}`]: sanne,
      [`DELETE ${deletePath(sanne)}`]: Response.json(
        {
          statusCode: 409,
          error: "Conflict",
          message: "x",
          code: "last_coordinator",
          blockers: [
            {
              role: "coordinator",
              workingGroupName: "Noord",
              organizationName: "Paddentrek Voorbeeldstad",
              contactEmail: null,
            },
            {
              role: "organizationAdmin",
              workingGroupName: null,
              organizationName: "Paddenwerkgroep Fictiefdorp",
              contactEmail: null,
            },
          ],
        },
        { status: 409 },
      ),
    }),
  );
  renderPortal("/delete-account");
  await search(sanne.email);
  const confirm = await askDelete();
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder account" }));
  expect(
    await within(confirm).findByText(
      `${sanne.name} is de enige coördinator van Noord. Maak eerst iemand anders coördinator. ` +
        `${sanne.name} is de enige beheerder van Paddenwerkgroep Fictiefdorp. Maak eerst iemand anders beheerder.`,
    ),
  ).toBeVisible();
  expect(screen.queryByText(/is verwijderd/)).toBeNull();
  await userEvent.click(within(confirm).getByRole("button", { name: "Annuleer" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByRole("heading", { level: 2, name: sanne.name })).toBeVisible();
});

test("a 404 on the deletion shows Dit bestaat niet meer. in the dialog", async () => {
  mockFetch(
    routesFor({
      [`POST ${lookupPath}`]: sanne,
      [`DELETE ${deletePath(sanne)}`]: errorResponse(404, "not_found"),
    }),
  );
  renderPortal("/delete-account");
  await search(sanne.email);
  const confirm = await askDelete();
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder account" }));
  expect(await within(confirm).findByText("Dit bestaat niet meer.")).toBeVisible();
});

test("the dialog cannot be closed while the deletion runs", async () => {
  mockFetch(
    routesFor({
      [`POST ${lookupPath}`]: sanne,
      [`DELETE ${deletePath(sanne)}`]: new Response(null, { status: 204 }),
    }),
  );
  const release = holdRequests((request) => request.method === "DELETE");
  renderPortal("/delete-account");
  await search(sanne.email);
  const confirm = await askDelete();
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder account" }));
  await waitFor(() =>
    expect(within(confirm).getByRole("button", { name: "Even geduld…" })).toBeDisabled(),
  );
  expect(within(confirm).getByRole("button", { name: "Annuleer" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("alertdialog")).toBeVisible();
  release();
  expect(await screen.findByText(`Het account van ${sanne.name} is verwijderd.`)).toBeVisible();
});
