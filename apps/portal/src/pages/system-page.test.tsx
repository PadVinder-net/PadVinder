import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
import {
  meFixture,
  platformAdminMeFixture,
  workerStaleFixture,
} from "@padvinder/contracts/fixtures";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { routes } from "../router";
import { SystemPage } from "./system-page";

class FakeEventSource {
  addEventListener() {}
  close() {}
}

beforeEach(() => vi.stubGlobal("EventSource", FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SystemPage />
    </QueryClientProvider>,
  );
}

test("system page shows the status", async () => {
  // The API answers 503 with the health body when something is wrong.
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "/api/health": Response.json(workerStaleFixture, { status: 503 }),
  });
  renderPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Systeemstatus" })).toBeVisible();
  expect(await screen.findByText("Er is een storing")).toBeVisible();
});

test("system page shows the load error", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "/api/health": new Response("boom", { status: 500 }),
  });
  renderPage();
  expect(await screen.findByText(/De server is niet bereikbaar/)).toBeVisible();
});

test("anyone else gets no access and a way back", async () => {
  const { calls } = mockFetch({ "/api/me": meFixture, "/api/health": workerStaleFixture });
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/system"] })} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Je hebt geen toegang tot deze pagina.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Terug" })).toHaveAttribute("href", "/");
  expect(screen.queryByText("Alles werkt")).toBeNull();
  expect(calls).not.toContain("/api/health");
});
