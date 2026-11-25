import { mockFetch } from "@padvinder/api-client/testing";
import {
  applicantMeFixture,
  coordinatorMeFixture,
  organizationDetailFixture,
  organizationsFixture,
  platformAdminMeFixture,
} from "@padvinder/contracts/fixtures";
import type { MeResponse, Organization } from "@padvinder/contracts";
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

const [fictiefdorp, voorbeeldstad] = organizationsFixture as [Organization, Organization];
const connection = "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";

const created = { id: "0192f3c0-0000-7000-8000-0000000000a9", name: "Nieuwe organisatie" };
const createdDetail = {
  ...created,
  contactEmail: null,
  admins: organizationDetailFixture.admins.slice(0, 1),
};

/** An admin of Paddentrek Voorbeeldstad only, without a membership. */
const adminMe: MeResponse = { ...applicantMeFixture, organizationAdminOf: [voorbeeldstad] };

async function openNewOrganization() {
  await userEvent.click(await screen.findByRole("button", { name: "Nieuwe organisatie" }));
  return screen.findByRole("dialog", { name: "Nieuwe organisatie" });
}

async function fillNewOrganization(dialog: HTMLElement) {
  await userEvent.type(within(dialog).getByLabelText("Naam"), "Nieuwe organisatie");
  await userEvent.type(
    within(dialog).getByLabelText("E-mailadres van de beheerder"),
    "eerste@example.test",
  );
}

test("a platform admin sees the table and adds an organization", async () => {
  const requests = recordRequests();
  const routes: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    "GET /api/organizations": { organizations: organizationsFixture },
    "POST /api/organizations": Response.json(createdDetail, { status: 201 }),
    [`/api/organizations/${created.id}`]: createdDetail,
    "/api/managed-working-groups": { workingGroups: [] },
  };
  mockFetch(routes);
  const { router } = renderPortal("/organizations");
  expect(await screen.findByRole("heading", { level: 1, name: "Organisaties" })).toBeVisible();
  expect(await screen.findByRole("button", { name: voorbeeldstad.name })).toBeVisible();
  const dialog = await openNewOrganization();
  await fillNewOrganization(dialog);
  routes["GET /api/organizations"] = { organizations: [...organizationsFixture, created] };
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Organisatie Nieuwe organisatie is toegevoegd.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(router.state.location.pathname).toBe(`/organizations/${created.id}`);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Nieuwe organisatie" }),
  ).toBeVisible();
  expect(requestsTo(requests, "POST", "/api/organizations")).toEqual([
    {
      method: "POST",
      path: "/api/organizations",
      body: { name: "Nieuwe organisatie", adminEmail: "eerste@example.test", contactEmail: null },
    },
  ]);
});

test("while the organizations load, the page says so; a failed load offers Probeer opnieuw", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture });
  neverAnswer((request) => request.url.endsWith("/api/organizations"));
  renderPortal("/organizations");
  expect(await screen.findByText("Organisaties laden…")).toBeVisible();
});

test("a failed load says so and Probeer opnieuw loads again", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    "/api/organizations": new Response("boom", { status: 500 }),
  };
  mockFetch(routes);
  renderPortal("/organizations");
  expect(await screen.findByText(connection)).toBeVisible();
  routes["/api/organizations"] = { organizations: organizationsFixture };
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(await screen.findByRole("button", { name: fictiefdorp.name })).toBeVisible();
});

test("a taken name shows its text under Naam and the modal stays; a refused address shows under its field", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    "GET /api/organizations": { organizations: organizationsFixture },
    "POST /api/organizations": errorResponse(409, "name_taken", [{ path: "name", message: "x" }]),
  };
  mockFetch(routes);
  renderPortal("/organizations");
  const dialog = await openNewOrganization();
  await fillNewOrganization(dialog);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  const taken = "Er is al een organisatie met deze naam.";
  expect(await within(dialog).findByText(taken)).toBeVisible();
  expect(within(dialog).getByLabelText("Naam")).toHaveAccessibleDescription(taken);

  routes["POST /api/organizations"] = errorResponse(400, "invalid_request", [
    { path: "adminEmail", message: "x" },
  ]);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await within(dialog).findByText("Vul een geldig e-mailadres in.")).toBeVisible();
  expect(within(dialog).getByLabelText("E-mailadres van de beheerder")).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  routes["POST /api/organizations"] = errorResponse(400, "invalid_request", [
    { path: "contactEmail", message: "x" },
  ]);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  await waitFor(() =>
    expect(within(dialog).getByLabelText("Contactadres")).toHaveAttribute("aria-invalid", "true"),
  );
  expect(screen.getByRole("dialog", { name: "Nieuwe organisatie" })).toBeVisible();
  expect(screen.queryByText(/is toegevoegd/)).toBeNull();
});

test("while an organization is saved, Escape does not close the modal", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/organizations": { organizations: organizationsFixture },
    "POST /api/organizations": Response.json(createdDetail, { status: 201 }),
    [`/api/organizations/${created.id}`]: createdDetail,
    "/api/managed-working-groups": { workingGroups: [] },
  });
  const release = holdRequests((request) => request.method === "POST");
  renderPortal("/organizations");
  const dialog = await openNewOrganization();
  await fillNewOrganization(dialog);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Even geduld…" })).toBeVisible(),
  );
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Nieuwe organisatie" })).toBeVisible();
  release();
  expect(await screen.findByText("Organisatie Nieuwe organisatie is toegevoegd.")).toBeVisible();
});

test("an admin of one organization who opens /organizations lands on its page", async () => {
  const { calls } = mockFetch({
    "/api/me": adminMe,
    [`/api/organizations/${voorbeeldstad.id}`]: organizationDetailFixture,
    "/api/managed-working-groups": { workingGroups: [] },
  });
  const { router } = renderPortal("/organizations");
  expect(await screen.findByRole("heading", { level: 1, name: voorbeeldstad.name })).toBeVisible();
  expect(router.state.location.pathname).toBe(`/organizations/${voorbeeldstad.id}`);
  expect(calls).not.toContain("/api/organizations");
});

test("an admin of two organizations sees the table without Nieuwe organisatie", async () => {
  mockFetch({
    "/api/me": { ...applicantMeFixture, organizationAdminOf: organizationsFixture },
    "/api/organizations": { organizations: organizationsFixture },
  });
  renderPortal("/organizations");
  expect(await screen.findByRole("button", { name: voorbeeldstad.name })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Nieuwe organisatie" })).toBeNull();
});

test("a coordinator who opens /organizations sees the not-found page", async () => {
  const { calls } = mockFetch({ "/api/me": coordinatorMeFixture });
  renderPortal("/organizations");
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
  expect(calls).not.toContain("/api/organizations");
});

test("when a refetch of the list fails, the table stays and no error shows", async () => {
  const requests = recordRequests();
  const routes: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    "/api/organizations": { organizations: organizationsFixture },
    "/api/managed-working-groups": { workingGroups: [] },
  };
  mockFetch(routes);
  renderPortal("/organizations");
  expect(await screen.findByRole("button", { name: voorbeeldstad.name })).toBeVisible();
  routes["/api/organizations"] = new Response("boom", { status: 500 });
  emitAccessChanged(platformAdminMeFixture.user.id);
  await waitFor(() =>
    expect(requestsTo(requests, "GET", "/api/organizations").length).toBeGreaterThan(1),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByRole("button", { name: voorbeeldstad.name })).toBeVisible();
  expect(screen.queryByText(connection)).toBeNull();
});
