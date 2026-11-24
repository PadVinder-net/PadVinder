import { meFixture, workingGroupsFixture } from "@padvinder/contracts/fixtures";
import { getMeQueryKey } from "@padvinder/api-client";
import { mockFetch } from "@padvinder/api-client/testing";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { notLoggedIn, renderApp } from "../testing/render-app";

vi.mock("../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

const directory = { workingGroups: workingGroupsFixture };

test("Log uit logs out, clears the cache and shows the login screen without a notice", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": meFixture,
    "/api/working-groups": directory,
    "/api/auth/sign-out": { success: true },
  };
  mockFetch(routes);
  const { client } = renderApp("/app/more");
  const button = await screen.findByRole("button", { name: "Log uit" });
  await screen.findByRole("link", { name: "Leden" });
  routes["/api/me"] = notLoggedIn();
  await userEvent.click(button);
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
  expect(client.getQueryCache().findAll({ queryKey: [{ _id: "listWorkingGroups" }] })).toHaveLength(
    0,
  );
  expect(screen.queryByText("Je account is verwijderd.")).toBeNull();
});

test("Log uit that fails keeps the user logged in and says so", async () => {
  mockFetch({
    "/api/me": meFixture,
    "/api/working-groups": directory,
    "/api/auth/sign-out": new Response("boom", { status: 500 }),
  });
  const { client } = renderApp("/app/more");
  await userEvent.click(await screen.findByRole("button", { name: "Log uit" }));
  expect(
    await screen.findByText(
      "Uitloggen lukt nu niet. Controleer je verbinding en probeer het opnieuw.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("heading", { level: 1, name: "Meer" })).toBeVisible();
  expect(client.getQueryData(getMeQueryKey())).toEqual(meFixture);
});

test("Log uit when the session had already ended goes to the login screen without a message", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": meFixture,
    "/api/working-groups": directory,
    "/api/auth/sign-out": Response.json({ code: "FAILED_TO_GET_SESSION" }, { status: 400 }),
  };
  mockFetch(routes);
  renderApp("/app/more");
  const button = await screen.findByRole("button", { name: "Log uit" });
  routes["/api/me"] = notLoggedIn();
  await userEvent.click(button);
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
  expect(screen.queryByText(/Uitloggen lukt nu niet/)).toBeNull();
});

test("more screen shows the app version and build", async () => {
  mockFetch({ "/api/me": meFixture, "/api/working-groups": directory });
  renderApp("/app/more");
  expect(await screen.findByText("App-versie 2027.0.0 (dev)")).toBeVisible();
});
