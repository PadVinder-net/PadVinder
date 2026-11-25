import { mockFetch } from "@padvinder/api-client/testing";
import {
  applicantMeFixture,
  coordinatorMeFixture,
  managedWorkingGroupsFixture,
  meFixture,
  organizationsFixture,
  platformAdminMeFixture,
} from "@padvinder/contracts/fixtures";
import type { ManagedWorkingGroup, Member, MeResponse } from "@padvinder/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";
import {
  errorResponse,
  holdRequests,
  neverAnswer,
  recordRequests,
  requestsTo,
} from "../testing/requests";

const voorbeeldstad = managedWorkingGroupsFixture[0]!.organization;
const noord = managedWorkingGroupsFixture[0]!;

/** An admin of Paddentrek Voorbeeldstad, without a membership. */
const adminMe: MeResponse = { ...applicantMeFixture, organizationAdminOf: [voorbeeldstad] };

const oost: ManagedWorkingGroup = {
  id: "0192f3c0-0000-7000-8000-0000000000b9",
  name: "Oost",
  city: "Voorbeeldstad",
  active: true,
  organization: voorbeeldstad,
  memberCount: 1,
  pendingRequestCount: 0,
};

const ownMembership: Member = {
  membershipId: "0192f3c0-0000-7000-8000-0000000000e9",
  userId: adminMe.user.id,
  name: adminMe.user.name,
  isCoordinator: true,
  email: adminMe.user.email,
  phone: null,
  hasLoggedIn: true,
};

const createPath = `/api/organizations/${voorbeeldstad.id}/working-groups`;
const connection = "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";

async function openNewWorkingGroup() {
  await userEvent.click(await screen.findByRole("button", { name: "Nieuwe werkgroep" }));
  return screen.findByRole("dialog", { name: "Nieuwe werkgroep" });
}

async function fillNewWorkingGroup(dialog: HTMLElement) {
  await userEvent.type(within(dialog).getByLabelText("Naam"), "Oost");
  await userEvent.type(within(dialog).getByLabelText("Plaats"), "Voorbeeldstad");
}

async function expectNotFound() {
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
}

test("a coordinator sees their groups and no Nieuwe werkgroep", async () => {
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/managed-working-groups": { workingGroups: [noord] },
    [`/api/working-groups/${noord.id}/members`]: { members: [] },
  });
  const { router } = renderPortal("/working-groups");
  expect(await screen.findByRole("heading", { level: 1, name: "Werkgroepen" })).toBeVisible();
  const open = await screen.findByRole("button", { name: "Noord" });
  expect(screen.getByRole("cell", { name: "Voorbeeldstad" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Nieuwe werkgroep" })).toBeNull();
  await userEvent.click(open);
  expect(router.state.location.pathname).toBe(`/working-groups/${noord.id}`);
  expect(await screen.findByRole("heading", { level: 1, name: "Noord" })).toBeVisible();
});

test("while the working groups load, the page says so", async () => {
  mockFetch({ "/api/me": adminMe });
  neverAnswer((request) => request.url.endsWith("/api/managed-working-groups"));
  renderPortal("/working-groups");
  expect(await screen.findByText("Werkgroepen laden…")).toBeVisible();
  expect(screen.getByRole("heading", { level: 1, name: "Werkgroepen" })).toBeVisible();
});

test("a failed load says so and Probeer opnieuw loads again", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": adminMe,
    "/api/managed-working-groups": new Response("boom", { status: 500 }),
  };
  mockFetch(routes);
  renderPortal("/working-groups");
  expect(await screen.findByText(connection)).toBeVisible();
  routes["/api/managed-working-groups"] = { workingGroups: [noord] };
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(await screen.findByRole("button", { name: "Noord" })).toBeVisible();
});

test("an admin adds a working group and lands on its page with the toast", async () => {
  const requests = recordRequests();
  const routes: Record<string, unknown> = {
    "/api/me": adminMe,
    "GET /api/managed-working-groups": { workingGroups: [noord] },
    [`POST ${createPath}`]: Response.json(oost, { status: 201 }),
    [`/api/working-groups/${oost.id}/members`]: { members: [ownMembership] },
  };
  mockFetch(routes);
  const { router } = renderPortal("/working-groups");
  const dialog = await openNewWorkingGroup();
  // One organization: it is named, not chosen.
  expect(within(dialog).getByText("Paddentrek Voorbeeldstad")).toBeVisible();
  // The first coordinator starts as the person who is logged in.
  expect(within(dialog).getByLabelText("E-mailadres van de coördinator")).toHaveValue(
    adminMe.user.email,
  );
  await fillNewWorkingGroup(dialog);
  routes["GET /api/managed-working-groups"] = { workingGroups: [noord, oost] };
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Werkgroep Oost is toegevoegd.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(router.state.location.pathname).toBe(`/working-groups/${oost.id}`);
  expect(await screen.findByRole("heading", { level: 1, name: "Oost" })).toBeVisible();
  // The creator is in Leden, as coordinator.
  expect(await screen.findByRole("cell", { name: /Noor de Vries\s*Coördinator/ })).toBeVisible();
  expect(requestsTo(requests, "POST", "/api/organizations")).toEqual([
    {
      method: "POST",
      path: createPath,
      body: { name: "Oost", city: "Voorbeeldstad", coordinatorEmail: adminMe.user.email },
    },
  ]);
});

test("a platform admin chooses from all organizations", async () => {
  const requests = recordRequests();
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
    "/api/organizations": { organizations: organizationsFixture },
    [`POST /api/organizations/${organizationsFixture[0]!.id}/working-groups`]: Response.json(
      { ...oost, organization: { id: organizationsFixture[0]!.id, name: "x" } },
      { status: 201 },
    ),
    [`/api/working-groups/${oost.id}/members`]: { members: [] },
  });
  renderPortal("/working-groups");
  const dialog = await openNewWorkingGroup();
  expect(within(dialog).getByRole("combobox", { name: "Organisatie" })).toHaveTextContent(
    organizationsFixture[0]!.name,
  );
  await fillNewWorkingGroup(dialog);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Werkgroep Oost is toegevoegd.")).toBeVisible();
  expect(requestsTo(requests, "POST", "/api/organizations").map((r) => r.path)).toEqual([
    `/api/organizations/${organizationsFixture[0]!.id}/working-groups`,
  ]);
});

test("a taken name and a person outside the organization each show their text under the field, and the modal stays", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": adminMe,
    "GET /api/managed-working-groups": { workingGroups: [noord] },
    [`POST ${createPath}`]: errorResponse(409, "name_taken", [{ path: "name", message: "x" }]),
  };
  mockFetch(routes);
  renderPortal("/working-groups");
  const dialog = await openNewWorkingGroup();
  await fillNewWorkingGroup(dialog);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  const taken = "Er is al een werkgroep met deze naam.";
  expect(await within(dialog).findByText(taken)).toBeVisible();
  expect(within(dialog).getByLabelText("Naam")).toHaveAccessibleDescription(taken);

  routes[`POST ${createPath}`] = errorResponse(409, "person_outside_organization", [
    { path: "coordinatorEmail", message: "x" },
  ]);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  const outside =
    "Deze persoon heeft al een account buiten Paddentrek Voorbeeldstad. Kies iemand anders of word eerst zelf coördinator.";
  expect(await within(dialog).findByText(outside)).toBeVisible();
  expect(within(dialog).getByLabelText("E-mailadres van de coördinator")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(within(dialog).queryByText(taken)).toBeNull();
  expect(screen.getByRole("dialog", { name: "Nieuwe werkgroep" })).toBeVisible();
  expect(screen.queryByText(/is toegevoegd/)).toBeNull();
});

test("an address the server refuses shows under the field; any other failure above the button", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": adminMe,
    "GET /api/managed-working-groups": { workingGroups: [noord] },
    [`POST ${createPath}`]: errorResponse(400, "invalid_request", [
      { path: "coordinatorEmail", message: "x" },
    ]),
  };
  mockFetch(routes);
  renderPortal("/working-groups");
  let dialog = await openNewWorkingGroup();
  await fillNewWorkingGroup(dialog);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await within(dialog).findByText("Vul een geldig e-mailadres in.")).toBeVisible();
  expect(within(dialog).getByLabelText("E-mailadres van de coördinator")).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  routes[`POST ${createPath}`] = errorResponse(403, "not_allowed");
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await within(dialog).findByText("Dit mag je niet doen.")).toBeVisible();

  // Closed and opened again, the form starts clean.
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  dialog = await openNewWorkingGroup();
  expect(within(dialog).queryByText("Dit mag je niet doen.")).toBeNull();
  expect(within(dialog).getByLabelText("Naam")).toHaveValue("");
});

test("while a new working group is saved, Escape does not close the modal", async () => {
  mockFetch({
    "/api/me": adminMe,
    "GET /api/managed-working-groups": { workingGroups: [noord] },
    [`POST ${createPath}`]: Response.json(oost, { status: 201 }),
    [`/api/working-groups/${oost.id}/members`]: { members: [ownMembership] },
  });
  const release = holdRequests((request) => request.method === "POST");
  renderPortal("/working-groups");
  const dialog = await openNewWorkingGroup();
  await fillNewWorkingGroup(dialog);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Even geduld…" })).toBeVisible(),
  );
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Nieuwe werkgroep" })).toBeVisible();
  release();
  expect(await screen.findByText("Werkgroep Oost is toegevoegd.")).toBeVisible();
});

test("a volunteer who opens /working-groups or a group's page sees the not-found page", async () => {
  const { calls } = mockFetch({ "/api/me": meFixture });
  renderPortal("/working-groups");
  await expectNotFound();
  expect(screen.queryByRole("heading", { name: "Werkgroepen" })).toBeNull();
  expect(calls).not.toContain("/api/managed-working-groups");
});

test("a volunteer who opens a group's page sees the not-found page", async () => {
  const { calls } = mockFetch({ "/api/me": meFixture });
  renderPortal(`/working-groups/${noord.id}`);
  await expectNotFound();
  expect(calls).not.toContain("/api/managed-working-groups");
  expect(calls).not.toContain(`/api/working-groups/${noord.id}/members`);
});
