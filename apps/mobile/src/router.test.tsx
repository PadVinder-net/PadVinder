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
import { appBasename, buildRoutes, isDevCrashOutsideRouter, routes } from "./router";
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
    "profile/join",
    "membership-requests",
    "membership-requests/:requestId",
    "members",
    "members/:membershipId",
    "system",
    "report-problem",
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
    ["/app/more/profile/join", "/app/more/profile"],
    ["/app/more/membership-requests", "/app/more"],
    [`/app/more/membership-requests/${request.id}`, "/app/more/membership-requests"],
    ["/app/more/members", "/app/more"],
    [`/app/more/members/${member.membershipId}`, "/app/more/members"],
    ["/app/more/system", "/app/more"],
    ["/app/more/report-problem", "/app/more"],
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

/** Every path in a route table, joined with its parents' paths. */
function allPaths(list: RouteObject[], parent = ""): string[] {
  return list.flatMap((route) => {
    const path = route.path ? `${parent}/${route.path}` : parent;
    return [...(route.path ? [path] : []), ...allPaths(route.children ?? [], path)];
  });
}

test("the crash routes for the end-to-end tests exist only under the dev server", () => {
  expect(allPaths(buildRoutes({ dev: true }))).toContain("/dev/crash");
  expect(allPaths(buildRoutes({ dev: false })).filter((path) => path.includes("dev"))).toEqual([]);
  expect(isDevCrashOutsideRouter("/app/dev/crash-outside-router", true)).toBe(true);
  expect(isDevCrashOutsideRouter("/app/dev/crash-outside-router", false)).toBe(false);
  expect(isDevCrashOutsideRouter("/app/dev/crash", true)).toBe(false);
});

test("the top route has the crash screen as its error element", () => {
  for (const dev of [true, false]) expect(buildRoutes({ dev })[0]!.errorElement).toBeTruthy();
});
