import {
  coordinatorMeFixture,
  meFixture,
  requestsForReviewFixture,
  workingGroupsFixture,
} from "@padvinder/contracts/fixtures";
import { mockFetch } from "@padvinder/api-client/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { errorResponse, notLoggedIn, renderApp } from "../../testing/render-app";

vi.mock("../../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

const noord = workingGroupsFixture.find((g) => g.name === "Noord")!;
const directory = { workingGroups: workingGroupsFixture };
const [noor, sem] = requestsForReviewFixture;
const requestPath = `/api/membership-requests/${noor!.id}`;
const noordRequestsPath = `/api/working-groups/${noord.id}/membership-requests`;

function coordinatorRoutes(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "/api/me": coordinatorMeFixture,
    "/api/working-groups": directory,
    [noordRequestsPath]: { membershipRequests: [noor, sem] },
    [requestPath]: noor,
    ...overrides,
  };
}

test("the list shows the open requests and opens one", async () => {
  mockFetch(coordinatorRoutes());
  const { router } = renderApp("/app/more/membership-requests");
  expect(await screen.findByRole("heading", { name: "Aanmeldingen" })).toBeVisible();
  await userEvent.click(await screen.findByRole("button", { name: /Noor Jansen/ }));
  expect(router.state.location.pathname).toBe(`/app/more/membership-requests/${noor!.id}`);
  expect(await screen.findByRole("heading", { name: "Noor Jansen" })).toBeVisible();
  expect(screen.getByRole("link", { name: "noor@example.test" })).toHaveAttribute(
    "href",
    "mailto:noor@example.test",
  );
});

test("approving returns to the list with the message", async () => {
  const routes = coordinatorRoutes({
    [`POST ${requestPath}/approve`]: { ...noor, status: "approved", decidedAt: noor!.requestedAt },
  });
  mockFetch(routes);
  const { router } = renderApp(`/app/more/membership-requests/${noor!.id}`);
  const approve = await screen.findByRole("button", { name: "Keur goed" });
  routes[noordRequestsPath] = { membershipRequests: [sem] };
  await userEvent.click(approve);
  expect(await screen.findByText("Noor Jansen is toegelaten.")).toBeVisible();
  expect(router.state.location.pathname).toBe("/app/more/membership-requests");
  // The list loads after the navigation: wait for it, then check that Noor is gone.
  expect(await screen.findByRole("button", { name: /Sem de Vries/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Noor Jansen/ })).toBeNull();
});

test("rejecting asks first, then returns to the list with the message", async () => {
  mockFetch(
    coordinatorRoutes({
      [`POST ${requestPath}/reject`]: {
        ...noor,
        status: "rejected",
        decidedAt: noor!.requestedAt,
      },
    }),
  );
  const { router } = renderApp(`/app/more/membership-requests/${noor!.id}`);
  await userEvent.click(await screen.findByRole("button", { name: "Wijs af" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Aanmelding afwijzen?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Wijs af" }));
  expect(await screen.findByText("De aanmelding is afgewezen.")).toBeVisible();
  expect(router.state.location.pathname).toBe("/app/more/membership-requests");
});

test("an already decided request shows the handled text", async () => {
  const routes = coordinatorRoutes({
    [`POST ${requestPath}/approve`]: errorResponse(409, "already_decided"),
  });
  const { calls } = mockFetch(routes);
  renderApp(`/app/more/membership-requests/${noor!.id}`);
  const approve = await screen.findByRole("button", { name: "Keur goed" });
  // Someone else approved it in the meantime.
  routes[requestPath] = { ...noor, status: "approved", decidedAt: noor!.requestedAt };
  await userEvent.click(approve);
  expect(await screen.findByText("Deze aanmelding is al behandeld.")).toBeVisible();
  // The request is loaded again and shows no buttons.
  await waitFor(() => expect(screen.queryByRole("button", { name: "Keur goed" })).toBeNull());
  expect(calls.filter((path) => path === requestPath)).toHaveLength(2);
});

test("a request opened by an outsider shows the not-found text", async () => {
  mockFetch(coordinatorRoutes({ [requestPath]: errorResponse(404, "not_found") }));
  renderApp(`/app/more/membership-requests/${noor!.id}`);
  expect(await screen.findByText("Dit bestaat niet meer.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Terug" })).toHaveAttribute(
    "href",
    "/app/more/membership-requests",
  );
});

test("a request opened by a volunteer of the group shows the not-allowed text", async () => {
  mockFetch(coordinatorRoutes({ [requestPath]: errorResponse(403, "not_allowed") }));
  renderApp(`/app/more/membership-requests/${noor!.id}`);
  expect(await screen.findByText("Dit mag je niet doen.")).toBeVisible();
});

test("the link from the mail survives the login screen", async () => {
  const routes = coordinatorRoutes({
    "/api/me": notLoggedIn(),
    "/api/auth/email-otp/send-verification-otp": { success: true },
    "/api/auth/sign-in/email-otp": { token: "x", user: {} },
  });
  mockFetch(routes);
  const { router } = renderApp(`/app/more/membership-requests/${noor!.id}`);
  await userEvent.type(await screen.findByLabelText("E-mailadres"), "coordinator@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  routes["/api/me"] = coordinatorMeFixture;
  await userEvent.type(await screen.findByLabelText("Code"), "123456");
  expect(await screen.findByRole("heading", { name: "Noor Jansen" })).toBeVisible();
  expect(router.state.location.pathname).toBe(`/app/more/membership-requests/${noor!.id}`);
});

test("a volunteer who opens the requests by URL is told no", async () => {
  const { calls } = mockFetch({ "/api/me": meFixture, "/api/working-groups": directory });
  renderApp("/app/more/membership-requests");
  expect(await screen.findByText("Dit mag je niet doen.")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Aanmeldingen" })).toBeNull();
  expect(calls.some((path) => path.endsWith("/membership-requests"))).toBe(false);
});

test("a coordinator without open requests reads that there are none", async () => {
  mockFetch(coordinatorRoutes({ [noordRequestsPath]: { membershipRequests: [] } }));
  renderApp("/app/more/membership-requests");
  expect(await screen.findByText("Er zijn geen open aanmeldingen.")).toBeVisible();
  expect(screen.queryByText("Dit mag je niet doen.")).toBeNull();
});
