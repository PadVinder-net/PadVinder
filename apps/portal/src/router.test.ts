import { mockFetch } from "@padvinder/api-client/testing";
import {
  meFixture,
  platformAdminMeFixture,
  workerStaleFixture,
} from "@padvinder/contracts/fixtures";
import { screen } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { expect, test } from "vitest";
import { routes } from "./router";
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
      "/species",
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

test("an unknown address shows the not-found page, inside the layout", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture });
  renderPortal("/does-not-exist");
  await expectNotFound();
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Beheer" })).toBeVisible();
});
