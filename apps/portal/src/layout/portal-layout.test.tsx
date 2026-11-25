import { FakeEventSource, mockFetch } from "@padvinder/api-client/testing";
import {
  healthyFixture,
  meFixture,
  platformAdminMeFixture,
  speciesFixture,
} from "@padvinder/contracts/fixtures";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";

/** What the server sends when someone's rights changed; the layout then asks /api/me again. */
function emitAccessChanged(userId: string) {
  act(() => {
    for (const source of FakeEventSource.instances)
      source.emit("access-changed", JSON.stringify({ type: "access-changed", userId }));
  });
}

test("the layout shows the items, the name and Log uit", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture, "/api/health": healthyFixture });
  renderPortal("/system");
  const navigation = await screen.findByRole("navigation", { name: "Beheer" });
  const links = within(navigation).getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual(["Soorten", "Systeemstatus"]);
  expect(links.map((link) => link.getAttribute("href"))).toEqual(["/species", "/system"]);
  expect(screen.getByText("PadVinder")).toBeVisible();
  expect(screen.getByText(platformAdminMeFixture.user.name)).toBeVisible();
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
  expect(await screen.findByRole("heading", { level: 1, name: "Systeemstatus" })).toBeVisible();
});

test("the current item is marked as the current page, not only by color", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture, "/api/health": healthyFixture });
  renderPortal("/system");
  const current = await screen.findByRole("link", { name: "Systeemstatus" });
  expect(current).toHaveAttribute("aria-current", "page");
  expect(current).toHaveClass("underline");
  const other = screen.getByRole("link", { name: "Soorten" });
  expect(other).not.toHaveAttribute("aria-current");
  expect(other).not.toHaveClass("underline");
});

test("someone without items sees no navigation, but the name and Log uit", async () => {
  mockFetch({ "/api/me": meFixture });
  renderPortal("/");
  expect(await screen.findByText(meFixture.user.name)).toBeVisible();
  expect(screen.queryByRole("navigation", { name: "Beheer" })).toBeNull();
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
});

test("the layout opens the live stream", async () => {
  mockFetch({ "/api/me": meFixture });
  renderPortal("/");
  await screen.findByText(meFixture.user.name);
  expect(FakeEventSource.instances.map((source) => source.url)).toEqual(["/api/events"]);
});

test("when me changes to a platform admin, the items appear without a reload", async () => {
  const routesByUrl: Record<string, unknown> = {
    "/api/me": meFixture,
    // Home sends a platform admin on to the species page.
    "/api/species": { species: speciesFixture },
  };
  mockFetch(routesByUrl);
  renderPortal("/");
  expect(
    await screen.findByText(
      "Het portaal is voor coördinatoren en beheerders. Tellen doe je in de app.",
    ),
  ).toBeVisible();
  routesByUrl["/api/me"] = platformAdminMeFixture;
  emitAccessChanged(meFixture.user.id);
  const navigation = await screen.findByRole("navigation", { name: "Beheer" });
  expect(within(navigation).getByRole("link", { name: "Soorten" })).toBeVisible();
  expect(within(navigation).getByRole("link", { name: "Systeemstatus" })).toBeVisible();
  expect(await screen.findByRole("cell", { name: "Gewone pad" })).toBeVisible();
});

test("when a platform admin loses the flag, an open /system turns into not found", async () => {
  const routesByUrl: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    "/api/health": healthyFixture,
  };
  mockFetch(routesByUrl);
  renderPortal("/system");
  expect(await screen.findByText("Alles werkt")).toBeVisible();
  routesByUrl["/api/me"] = { ...platformAdminMeFixture, user: meFixture.user };
  emitAccessChanged(meFixture.user.id);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
  expect(screen.queryByText("Alles werkt")).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Beheer" })).toBeNull();
});

test("Log uit logs out and shows the login screen", async () => {
  const routesByUrl: Record<string, unknown> = {
    "/api/me": meFixture,
    "/api/auth/sign-out": { success: true },
  };
  mockFetch(routesByUrl);
  renderPortal("/");
  const button = await screen.findByRole("button", { name: "Log uit" });
  routesByUrl["/api/me"] = Response.json(
    { statusCode: 401, error: "Unauthorized", message: "x", code: "not_logged_in" },
    { status: 401 },
  );
  await userEvent.click(button);
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
  // The gate unmounted the layout, which closed the live stream.
  expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
});

test("Log uit that fails keeps the user logged in and says so", async () => {
  mockFetch({
    "/api/me": meFixture,
    "/api/auth/sign-out": new Response("boom", { status: 500 }),
  });
  renderPortal("/");
  await userEvent.click(await screen.findByRole("button", { name: "Log uit" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Uitloggen lukt nu niet. Controleer je verbinding en probeer het opnieuw.",
  );
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
  expect(screen.getByText(meFixture.user.name)).toBeVisible();
});
