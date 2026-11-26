import { meFixture, waitingMeFixture, workingGroupsFixture } from "@padvinder/contracts/fixtures";
import { mockFetch } from "@padvinder/api-client/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { errorResponse, renderApp } from "../../testing/render-app";

vi.mock("../../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const directory = { workingGroups: workingGroupsFixture };
const dorp = workingGroupsFixture[1]!;
const zuidOost = workingGroupsFixture[4]!;

let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  vi.restoreAllMocks();
});

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
  restoreFetch = () => (globalThis.fetch = inner);
  return { bodies };
}

const choose = async (name: RegExp) => userEvent.click(await screen.findByRole("radio", { name }));
const join = () => screen.getByRole("button", { name: "Meld je aan" });

test("a member sees the button, and the picker without their own group", async () => {
  mockFetch({ "/api/me": meFixture, "/api/working-groups": directory });
  renderApp("/app/more/profile");
  await userEvent.click(
    await screen.findByRole("button", { name: "Meld je aan bij nog een werkgroep" }),
  );
  expect(await screen.findByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
  expect(screen.getByRole("radio", { name: /Dorp/ })).toBeInTheDocument();
  // Noord is the member's own group.
  expect(screen.queryByRole("radio", { name: /Noord/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Terug" })).toHaveAttribute("href", "/app/more/profile");
});

test("choosing a group sends one request with an id made at the tap, and returns to Profiel", async () => {
  const { bodies } = recordBodies();
  const routes: Record<string, unknown> = {
    "/api/me": meFixture,
    "/api/working-groups": directory,
    "POST /api/membership-requests": Response.json({}, { status: 201 }),
  };
  mockFetch(routes);
  const { router } = renderApp("/app/more/profile/join");
  await choose(/Dorp/);
  routes["/api/me"] = {
    ...meFixture,
    membershipRequest: { ...waitingMeFixture.membershipRequest!, workingGroup: dorp },
  };
  await userEvent.click(join());
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]!.id).toMatch(uuidV7);
  expect(bodies[0]!.workingGroupId).toBe(dorp.id);
  expect(new Date(bodies[0]!.requestedAt).toString()).not.toBe("Invalid Date");
  expect(await screen.findByRole("heading", { name: "Profiel" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/app/more/profile");
  expect(await screen.findByText("Je aanmelding bij Dorp wacht op goedkeuring.")).toBeVisible();
});

test("a second tap after a failed send uses the same id", async () => {
  const { bodies } = recordBodies();
  mockFetch({
    "/api/me": meFixture,
    "/api/working-groups": directory,
    "POST /api/membership-requests": errorResponse(429, "too_many_requests"),
  });
  renderApp("/app/more/profile/join");
  await choose(/Dorp/);
  await userEvent.click(join());
  expect(await screen.findByRole("alert")).toHaveTextContent("te vaak");
  await userEvent.click(join());
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]!.id).toBe(bodies[0]!.id);
  expect(bodies[1]!.requestedAt).toBe(bodies[0]!.requestedAt);
});

test("another group makes a new id", async () => {
  const { bodies } = recordBodies();
  mockFetch({
    "/api/me": meFixture,
    "/api/working-groups": directory,
    "POST /api/membership-requests": errorResponse(429, "too_many_requests"),
  });
  renderApp("/app/more/profile/join");
  await choose(/Dorp/);
  await userEvent.click(join());
  await screen.findByRole("alert");
  await choose(/Zuid-Oost/);
  await userEvent.click(join());
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]!.id).not.toBe(bodies[0]!.id);
  expect(bodies[1]!.workingGroupId).toBe(zuidOost.id);
});

test("a group that is gone shows the text and reloads the list", async () => {
  const { bodies } = recordBodies();
  const { calls } = mockFetch({
    "/api/me": meFixture,
    "/api/working-groups": directory,
    "POST /api/membership-requests": errorResponse(404, "not_found"),
  });
  renderApp("/app/more/profile/join");
  await choose(/Dorp/);
  await userEvent.click(join());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Deze werkgroep bestaat niet meer. Kies een andere werkgroep.",
  );
  await waitFor(() =>
    expect(calls.filter((path) => path === "/api/working-groups")).toHaveLength(2),
  );
  await userEvent.click(join());
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]!.id).not.toBe(bodies[0]!.id);
});

test("a member of every group sees that there is nothing to join", async () => {
  mockFetch({
    "/api/me": {
      ...meFixture,
      memberships: workingGroupsFixture.map((workingGroup, index) => ({
        id: `0192f3c0-0000-7000-8000-0000000001${index}0`,
        isCoordinator: false,
        workingGroup,
      })),
    },
    "/api/working-groups": directory,
  });
  renderApp("/app/more/profile/join");
  expect(await screen.findByText("Je bent al lid van alle werkgroepen.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Meld je aan" })).toBeNull();
});

test("the directory failing shows the connection text with a retry", async () => {
  mockFetch({ "/api/me": meFixture, "/api/working-groups": errorResponse(500, "internal") });
  renderApp("/app/more/profile/join");
  const alert = await screen.findByRole("button", { name: "Probeer opnieuw" });
  expect(within(alert.parentElement!).getByText(/verbinding|internet/i)).toBeVisible();
});
