import { healthyFixture, meFixture, platformAdminMeFixture } from "@padvinder/contracts/fixtures";
import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { expect, test } from "vitest";
import { AuthGate } from "../auth/auth-gate";
import { routes } from "../router";

function renderHome(client = createTestQueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />
      </AuthGate>
    </QueryClientProvider>,
  );
}

test("a platform admin sees the link to the system status", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture });
  renderHome();
  expect(await screen.findByRole("heading", { level: 1, name: "PadVinder" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Systeemstatus" })).toHaveAttribute("href", "/system");
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
});

test("anyone else sees that there is nothing to do yet, and can log out", async () => {
  mockFetch({ "/api/me": meFixture });
  renderHome();
  expect(
    await screen.findByText("Hier is nog niets te doen. Het beheer komt binnenkort."),
  ).toBeVisible();
  expect(screen.queryByRole("link", { name: "Systeemstatus" })).toBeNull();
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
});

test("Log uit logs out and shows the login screen", async () => {
  const routesByUrl: Record<string, unknown> = {
    "/api/me": meFixture,
    "/api/health": healthyFixture,
    "/api/auth/sign-out": { success: true },
  };
  mockFetch(routesByUrl);
  renderHome();
  const button = await screen.findByRole("button", { name: "Log uit" });
  routesByUrl["/api/me"] = Response.json(
    { statusCode: 401, error: "Unauthorized", message: "x", code: "not_logged_in" },
    { status: 401 },
  );
  await userEvent.click(button);
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
});

test("Log uit that fails keeps the user logged in and says so", async () => {
  mockFetch({
    "/api/me": meFixture,
    "/api/auth/sign-out": new Response("boom", { status: 500 }),
  });
  renderHome();
  await userEvent.click(await screen.findByRole("button", { name: "Log uit" }));
  expect(
    await screen.findByText(
      "Uitloggen lukt nu niet. Controleer je verbinding en probeer het opnieuw.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("heading", { level: 1, name: "PadVinder" })).toBeVisible();
});
