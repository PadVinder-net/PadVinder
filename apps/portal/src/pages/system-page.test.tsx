import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
import { platformAdminMeFixture, workerStaleFixture } from "@padvinder/contracts/fixtures";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { SystemPage } from "./system-page";

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
