import { healthyFixture, meFixture, meWithoutNameFixture } from "@padvinder/contracts/fixtures";
import { createQueryClient, getHealthOptions, getHealthQueryKey } from "@padvinder/api-client";
import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { AuthGate } from "./auth-gate";

const unauthorized = () =>
  Response.json(
    { statusCode: 401, error: "Unauthorized", message: "x", code: "not_logged_in" },
    { status: 401 },
  );

function renderGate(client = createTestQueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <p>de app</p>
      </AuthGate>
    </QueryClientProvider>,
  );
  return client;
}

test("shows the login screen when nobody is logged in", async () => {
  mockFetch({ "/api/me": unauthorized() });
  renderGate();
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
  expect(screen.queryByText("de app")).toBeNull();
});

test("shows a loading text first", () => {
  mockFetch({ "/api/me": meFixture });
  renderGate();
  expect(screen.getByText("PadVinder laden…")).toBeVisible();
});

test("asks for the name when it is empty", async () => {
  mockFetch({ "/api/me": meWithoutNameFixture });
  renderGate();
  expect(await screen.findByRole("heading", { name: "Hoe heet je?" })).toBeVisible();
  expect(screen.queryByText("de app")).toBeNull();
});

test("saving the name shows the app", async () => {
  let saved: unknown;
  mockFetch({ "/api/me": meWithoutNameFixture });
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "PATCH") {
      saved = await request.clone().json();
      return Response.json(meFixture);
    }
    return original(input, init);
  };
  try {
    renderGate();
    await userEvent.type(await screen.findByLabelText("Naam"), "Noor de Vries");
    await userEvent.click(screen.getByRole("button", { name: "Ga verder" }));
    expect(await screen.findByText("de app")).toBeVisible();
    expect(saved).toEqual({ name: "Noor de Vries", phone: null });
  } finally {
    globalThis.fetch = original;
  }
});

test("shows the app for a user with a name", async () => {
  mockFetch({ "/api/me": meFixture });
  renderGate();
  expect(await screen.findByText("de app")).toBeVisible();
});

test("a server error shows the retry message, not the login screen", async () => {
  mockFetch({ "/api/me": new Response("boom", { status: 500 }) });
  renderGate();
  expect(
    await screen.findByText("Het lukt nu niet. Controleer je verbinding en probeer het opnieuw."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Probeer opnieuw" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Log in bij PadVinder" })).toBeNull();
});

function Probe() {
  useQuery(getHealthOptions());
  return <p>de app</p>;
}

test("a 401 on another query brings back the login screen", async () => {
  const routes: Record<string, unknown> = { "/api/me": meFixture, "/api/health": healthyFixture };
  mockFetch(routes);
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <Probe />
      </AuthGate>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("de app")).toBeVisible();
  // The session ends: the next health request and the next /api/me both answer 401.
  routes["/api/me"] = unauthorized();
  routes["/api/health"] = unauthorized();
  await client.invalidateQueries({ queryKey: getHealthQueryKey() });
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
});
