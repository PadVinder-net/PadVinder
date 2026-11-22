import {
  applicantMeFixture,
  meFixture,
  rejectedMeFixture,
  waitingMeFixture,
  workingGroupsFixture,
} from "@padvinder/contracts/fixtures";
import { getMeQueryKey } from "@padvinder/api-client";
import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthGate } from "./auth-gate";

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const directory = { workingGroups: workingGroupsFixture };
const noord = workingGroupsFixture[2]!;
const dorp = workingGroupsFixture[1]!;

afterEach(() => vi.restoreAllMocks());

function renderGate(client = createTestQueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <p>de app</p>
      </AuthGate>
    </QueryClientProvider>,
  );
  return client;
}

function errorResponse(status: number, code: string) {
  return Response.json({ statusCode: status, error: "Error", message: "x", code }, { status });
}

/** mockFetch has no request body access, so wrap fetch to record bodies of the join. */
function recordBodies() {
  const bodies: { id: string; workingGroupId: string; requestedAt: string }[] = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (
      request.method === "POST" &&
      new URL(request.url).pathname.endsWith("/membership-requests")
    ) {
      bodies.push(await request.clone().json());
    }
    return inner(request);
  };
  return { bodies, restore: () => (globalThis.fetch = inner) };
}

async function choose(name: RegExp) {
  await userEvent.click(await screen.findByRole("radio", { name }));
}
const join = () => screen.getByRole("button", { name: "Meld je aan" });

test("an applicant sees the picker; choosing and joining posts a request", async () => {
  const { bodies, restore } = recordBodies();
  mockFetch({
    "/api/me": applicantMeFixture,
    "/api/working-groups": directory,
    "POST /api/membership-requests": Response.json({}, { status: 201 }),
  });
  renderGate();
  expect(await screen.findByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
  await choose(/Noord/);
  await userEvent.click(join());
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]!.id).toMatch(uuidV7);
  expect(bodies[0]!.workingGroupId).toBe(noord.id);
  expect(new Date(bodies[0]!.requestedAt).toString()).not.toBe("Invalid Date");
  restore();
});

test("a second tap after a failure sends the same id", async () => {
  const { bodies, restore } = recordBodies();
  mockFetch({
    "/api/me": applicantMeFixture,
    "/api/working-groups": directory,
    "POST /api/membership-requests": errorResponse(429, "too_many_requests"),
  });
  renderGate();
  await choose(/Noord/);
  await userEvent.click(join());
  expect(await screen.findByRole("alert")).toHaveTextContent("te vaak");
  await userEvent.click(join());
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]!.id).toBe(bodies[0]!.id);
  expect(bodies[1]!.requestedAt).toBe(bodies[0]!.requestedAt);
  restore();
});

test("choosing another group makes a new id", async () => {
  const { bodies, restore } = recordBodies();
  mockFetch({
    "/api/me": applicantMeFixture,
    "/api/working-groups": directory,
    "POST /api/membership-requests": errorResponse(429, "too_many_requests"),
  });
  renderGate();
  await choose(/Noord/);
  await userEvent.click(join());
  await screen.findByRole("alert");
  await choose(/Dorp/);
  await userEvent.click(join());
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]!.id).not.toBe(bodies[0]!.id);
  expect(bodies[1]!.workingGroupId).toBe(dorp.id);
  restore();
});

test("a group that no longer exists shows the text and reloads the list", async () => {
  const { calls } = mockFetch({
    "/api/me": applicantMeFixture,
    "/api/working-groups": directory,
    "POST /api/membership-requests": errorResponse(404, "not_found"),
  });
  renderGate();
  await choose(/Noord/);
  await userEvent.click(join());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Deze werkgroep bestaat niet meer. Kies een andere werkgroep.",
  );
  await waitFor(() =>
    expect(calls.filter((path) => path === "/api/working-groups")).toHaveLength(2),
  );
});

test("a waiting applicant sees Welkom! with the group's name", async () => {
  mockFetch({ "/api/me": waitingMeFixture });
  renderGate();
  expect(await screen.findByRole("heading", { name: "Welkom!" })).toBeVisible();
  expect(
    screen.getByText(new RegExp(waitingMeFixture.membershipRequest!.workingGroup.name)),
  ).toBeVisible();
});

test("when me changes to a member, the tabs appear without a reload", async () => {
  mockFetch({ "/api/me": waitingMeFixture });
  const client = renderGate();
  await screen.findByRole("heading", { name: "Welkom!" });
  client.setQueryData(getMeQueryKey(), meFixture);
  expect(await screen.findByText("de app")).toBeVisible();
});

test("a rejected applicant sees the picker with the notice", async () => {
  mockFetch({ "/api/me": rejectedMeFixture, "/api/working-groups": directory });
  renderGate();
  expect(await screen.findByRole("status")).toHaveTextContent("niet goedgekeurd");
  expect(screen.getByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
});

test("Profiel opens the profile and Terug returns", async () => {
  mockFetch({ "/api/me": applicantMeFixture, "/api/working-groups": directory });
  renderGate();
  await userEvent.click(await screen.findByRole("button", { name: "Profiel" }));
  expect(screen.getByRole("heading", { name: "Profiel" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Terug" }));
  expect(screen.getByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
});

test("the waiting screen also opens the profile", async () => {
  mockFetch({ "/api/me": waitingMeFixture });
  renderGate();
  await userEvent.click(await screen.findByRole("button", { name: "Profiel" }));
  expect(screen.getByRole("heading", { name: "Profiel" })).toBeVisible();
});

test("a member who is removed lands on the picker", async () => {
  mockFetch({ "/api/me": meFixture, "/api/working-groups": directory });
  const client = renderGate();
  expect(await screen.findByText("de app")).toBeVisible();
  client.setQueryData(getMeQueryKey(), applicantMeFixture);
  expect(await screen.findByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
});

test("a failed sign-out keeps the user logged in with a message", async () => {
  mockFetch({
    "/api/me": applicantMeFixture,
    "/api/working-groups": directory,
    "POST /api/auth/sign-out": new Response("boom", { status: 500 }),
  });
  renderGate();
  await userEvent.click(await screen.findByRole("button", { name: "Log uit" }));
  expect(await screen.findByText(/Uitloggen lukt nu niet/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
});

test("deleting the account ends at the login screen", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": applicantMeFixture,
    "/api/working-groups": directory,
    "DELETE /api/me": new Response(null, { status: 204 }),
  };
  mockFetch(routes);
  renderGate();
  await userEvent.click(await screen.findByRole("button", { name: "Profiel" }));
  await userEvent.click(screen.getByRole("button", { name: "Verwijder account" }));
  const confirm = await screen.findByRole("alertdialog");
  routes["/api/me"] = errorResponse(401, "not_logged_in");
  await userEvent.click(within(confirm).getByRole("button", { name: "Verwijder account" }));
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
});
