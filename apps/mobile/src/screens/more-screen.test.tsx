import { healthyFixture, meFixture } from "@padvinder/contracts/fixtures";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
import { AuthGate } from "../auth/auth-gate";
import { MoreScreen } from "./more-screen";

class FakeEventSource {
  addEventListener() {}
  close() {}
}

beforeEach(() => vi.stubGlobal("EventSource", FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

function renderScreen() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MoreScreen />
    </QueryClientProvider>,
  );
}

test("more screen shows the system status", async () => {
  mockFetch({ "/api/health": healthyFixture });
  renderScreen();
  expect(screen.getByRole("heading", { level: 1, name: "Meer" })).toBeVisible();
  expect(await screen.findByText("Alles werkt")).toBeVisible();
});

test("more screen shows the load error", async () => {
  mockFetch({ "/api/health": new Response("boom", { status: 500 }) });
  renderScreen();
  expect(await screen.findByText(/De server is niet bereikbaar/)).toBeVisible();
});

test("Log uit logs out, clears the cache and shows the login screen", async () => {
  const routes: Record<string, unknown> = {
    "/api/health": healthyFixture,
    "/api/me": meFixture,
    "/api/auth/sign-out": { success: true },
  };
  mockFetch(routes);
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <MoreScreen />
      </AuthGate>
    </QueryClientProvider>,
  );
  const button = await screen.findByRole("button", { name: "Log uit" });
  routes["/api/me"] = Response.json(
    { statusCode: 401, error: "Unauthorized", message: "x", code: "not_logged_in" },
    { status: 401 },
  );
  await userEvent.click(button);
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
  expect(client.getQueryCache().findAll({ queryKey: [{ _id: "getHealth" }] })).toHaveLength(0);
});
