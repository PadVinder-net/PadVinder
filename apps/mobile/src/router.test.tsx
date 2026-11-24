import {
  coordinatorMeFixture,
  healthyFixture,
  membersWithContactFixture,
  requestsForReviewFixture,
  workingGroupsFixture,
} from "@padvinder/contracts/fixtures";
import { mockFetch } from "@padvinder/api-client/testing";
import type { RouteObject } from "react-router";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { appBasename, routes } from "./router";
import { renderApp } from "./testing/render-app";

vi.mock("./hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

function renderAt(path: string) {
  render(
    <RouterProvider
      router={createMemoryRouter(routes, { basename: appBasename, initialEntries: [path] })}
    />,
  );
}

test("tab links stay inside the /app/ scope", () => {
  renderAt("/app/");
  expect(screen.getByRole("link", { name: "Vanavond" })).toHaveAttribute("href", "/app/");
  expect(screen.getByRole("link", { name: "Kaart" })).toHaveAttribute("href", "/app/map");
  expect(screen.getByRole("link", { name: "Resultaten" })).toHaveAttribute("href", "/app/results");
  expect(screen.getByRole("link", { name: "Meer" })).toHaveAttribute("href", "/app/more");
});

test("routes match under the basename", () => {
  renderAt("/app/");
  expect(screen.getByRole("heading", { level: 1, name: "Vanavond" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Vanavond" })).toHaveAttribute("aria-current", "page");
});

test("the Kaart route matches", () => {
  renderAt("/app/map");
  expect(screen.getByRole("heading", { level: 1, name: "Kaart" })).toBeVisible();
});

/** Every path under /more, as written in the route table. */
function morePaths(): string[] {
  const more = routes[0]!.children!.find((route: RouteObject) => route.path === "more")!;
  return more.children!.map((route: RouteObject) => (route.index ? "" : route.path!));
}

test("no route under /more is Dutch, and every sub-screen links back", async () => {
  expect(morePaths()).toEqual([
    "",
    "profile",
    "membership-requests",
    "membership-requests/:requestId",
    "members",
    "members/:membershipId",
    "system",
  ]);

  const noord = workingGroupsFixture.find((g) => g.name === "Noord")!;
  const request = requestsForReviewFixture[0]!;
  const member = membersWithContactFixture[1]!;
  const coordinatorAndPlatformAdmin = {
    ...coordinatorMeFixture,
    user: { ...coordinatorMeFixture.user, isPlatformAdmin: true },
  };
  const subScreens: Array<[string, string]> = [
    ["/app/more/profile", "/app/more"],
    ["/app/more/membership-requests", "/app/more"],
    [`/app/more/membership-requests/${request.id}`, "/app/more/membership-requests"],
    ["/app/more/members", "/app/more"],
    [`/app/more/members/${member.membershipId}`, "/app/more/members"],
    ["/app/more/system", "/app/more"],
  ];
  for (const [path, back] of subScreens) {
    mockFetch({
      "/api/me": coordinatorAndPlatformAdmin,
      "/api/health": healthyFixture,
      "/api/working-groups": { workingGroups: workingGroupsFixture },
      [`/api/working-groups/${noord.id}/membership-requests`]: { membershipRequests: [request] },
      [`/api/working-groups/${noord.id}/members`]: { members: membersWithContactFixture },
      [`/api/membership-requests/${request.id}`]: request,
    });
    const { unmount } = renderApp(path);
    expect(await screen.findByRole("link", { name: "Terug" }), path).toHaveAttribute("href", back);
    // The Meer tab stays the current one.
    expect(screen.getByRole("link", { name: "Meer" }), path).toHaveAttribute(
      "aria-current",
      "page",
    );
    unmount();
  }
});
