import { mockFetch } from "@padvinder/api-client/testing";
import {
  applicantMeFixture,
  meFixture,
  platformAdminMeFixture,
  twoOrganizationsMeFixture,
  workerStaleFixture,
} from "@padvinder/contracts/fixtures";
import { cleanup, screen } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { expect, test } from "vitest";
import { buildRoutes, isDevCrashOutsideRouter, routes } from "./router";
import { renderPortal } from "./testing/render-portal";

function collectPaths(list: RouteObject[], parent = ""): string[] {
  return list.flatMap((route) => {
    const path = route.path
      ? `${parent.replace(/\/$/, "")}/${route.path.replace(/^\//, "")}`
      : parent;
    return [...(route.path ? [path] : []), ...collectPaths(route.children ?? [], path)];
  });
}

async function expectNotFound() {
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
  expect(screen.getByText("Of je mag haar niet zien.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Terug naar het begin" })).toHaveAttribute("href", "/");
}

test("the portal has working group, species, system and not-found pages", () => {
  expect(collectPaths(routes)).toEqual(
    expect.arrayContaining([
      "/working-groups",
      "/working-groups/:workingGroupId",
      "/membership-requests",
      "/species",
      "/audit-log",
      "/platform-admins",
      "/delete-account",
      "/system",
      "/*",
    ]),
  );
});

test("no portal route starts with /app or /api", () => {
  for (const path of collectPaths(routes)) expect(path).not.toMatch(/^\/(app|api)(\/|$)/);
});

test("a volunteer who opens /system sees the not-found page", async () => {
  const { calls } = mockFetch({ "/api/me": meFixture, "/api/health": workerStaleFixture });
  renderPortal("/system");
  await expectNotFound();
  expect(screen.queryByRole("heading", { name: "Systeemstatus" })).toBeNull();
  expect(calls).not.toContain("/api/health");
});

test("an organization admin who opens /platform-admins or /delete-account sees the not-found page", async () => {
  const organizationAdminMe = {
    ...applicantMeFixture,
    organizationAdminOf: twoOrganizationsMeFixture.organizationAdminOf,
  };
  for (const path of ["/platform-admins", "/delete-account"]) {
    const { calls } = mockFetch({ "/api/me": organizationAdminMe });
    renderPortal(path);
    await expectNotFound();
    expect(calls).not.toContain("/api/platform-admins");
    cleanup();
  }
});

test("an unknown address shows the not-found page, inside the layout", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture });
  renderPortal("/does-not-exist");
  await expectNotFound();
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Beheer" })).toBeVisible();
});

test("the crash routes for the end-to-end tests exist only under the dev server", () => {
  expect(collectPaths(buildRoutes({ dev: true }))).toContain("/dev/crash");
  expect(collectPaths(buildRoutes({ dev: false })).filter((path) => path.includes("dev"))).toEqual(
    [],
  );
  expect(isDevCrashOutsideRouter("/dev/crash-outside-router", true)).toBe(true);
  expect(isDevCrashOutsideRouter("/dev/crash-outside-router", false)).toBe(false);
  expect(isDevCrashOutsideRouter("/dev/crash", true)).toBe(false);
});

test("the top route has the crash screen as its error element", () => {
  for (const dev of [true, false]) expect(buildRoutes({ dev })[0]!.errorElement).toBeTruthy();
});
