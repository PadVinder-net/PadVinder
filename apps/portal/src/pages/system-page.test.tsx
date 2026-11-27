import { createTestQueryClient, mockFetch, mockPendingFetch } from "@padvinder/api-client/testing";
import {
  healthyFixture,
  platformAdminMeFixture,
  workerStaleFixture,
} from "@padvinder/contracts/fixtures";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const CONNECTION_TEST = "POST /api/system/sentry-connection-test";

async function renderLoaded(connectionTest: unknown) {
  const mock = mockFetch({
    "/api/me": platformAdminMeFixture,
    "/api/health": healthyFixture,
    [CONNECTION_TEST]: connectionTest,
  });
  renderPage();
  expect(await screen.findByRole("heading", { name: "Verbinding met Sentry" })).toBeVisible();
  expect(
    screen.getByText(
      "Stuur een testmelding naar Sentry, één keer via IPv4 en één keer via IPv6. Zo zie je of deze server Sentry kan bereiken.",
    ),
  ).toBeVisible();
  return mock;
}

test("the connection test shows one line per address family", async () => {
  const { calls } = await renderLoaded({
    sentryOff: false,
    results: [
      { family: 4, status: 200 },
      { family: 6, status: "unreachable", answer: "ENETUNREACH" },
    ],
  });
  await userEvent.click(screen.getByRole("button", { name: "Test de verbinding" }));
  expect(await screen.findByText("IPv4: aangekomen (200)")).toBeVisible();
  expect(screen.getByText("IPv6: geen antwoord (ENETUNREACH)")).toBeVisible();
  expect(calls.filter((path) => path === "/api/system/sentry-connection-test")).toHaveLength(1);
});

test("a refusal shows the status and the answer", async () => {
  await renderLoaded({
    sentryOff: false,
    results: [
      { family: 4, status: 403, answer: "403 Forbidden" },
      { family: 6, status: 502 },
    ],
  });
  await userEvent.click(screen.getByRole("button", { name: "Test de verbinding" }));
  expect(await screen.findByText("IPv4: geweigerd (403): 403 Forbidden")).toBeVisible();
  expect(screen.getByText("IPv6: geweigerd (502)")).toBeVisible();
});

test("the connection test says when Sentry is off", async () => {
  await renderLoaded({ sentryOff: true, results: [] });
  await userEvent.click(screen.getByRole("button", { name: "Test de verbinding" }));
  expect(
    await screen.findByText("Sentry staat uit op deze server: SENTRY_DSN ontbreekt."),
  ).toBeVisible();
});

test("a failed request shows the error text", async () => {
  await renderLoaded(
    Response.json(
      { statusCode: 403, error: "Forbidden", message: "x", code: "not_allowed" },
      { status: 403 },
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Test de verbinding" }));
  expect(await screen.findByText("Dit mag je niet doen.")).toBeVisible();
});

test("the button is disabled while the test runs", async () => {
  await renderLoaded({ sentryOff: true, results: [] });
  mockPendingFetch();
  const button = screen.getByRole("button", { name: "Test de verbinding" });
  await userEvent.click(button);
  expect(button).toBeDisabled();
});
