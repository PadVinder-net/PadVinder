import { healthyFixture } from "@padvinder/contracts/fixtures";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
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

test("more screen shows the app version and build", async () => {
  mockFetch({ "/api/health": healthyFixture });
  renderScreen();
  expect(screen.getByText("App-versie 2027.0.0 (dev)")).toBeVisible();
  await screen.findByText("Alles werkt");
});
