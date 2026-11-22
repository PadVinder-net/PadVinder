import {
  applicantMeFixture,
  healthyFixture,
  meFixture,
  meWithoutNameFixture,
  waitingMeFixture,
} from "@padvinder/contracts/fixtures";
import {
  createQueryClient,
  getHealthOptions,
  getHealthQueryKey,
  getMeQueryKey,
} from "@padvinder/api-client";
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
  mockFetch({ "/api/me": meWithoutNameFixture, "PATCH /api/me": meFixture });
  renderGate();
  await userEvent.type(await screen.findByLabelText("Naam"), "Noor de Vries");
  await userEvent.click(screen.getByRole("button", { name: "Ga verder" }));
  expect(await screen.findByText("de app")).toBeVisible();
});

test("an applicant sees the picker, not the app", async () => {
  mockFetch({ "/api/me": applicantMeFixture, "/api/working-groups": { workingGroups: [] } });
  renderGate();
  expect(await screen.findByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
  expect(screen.queryByText("de app")).toBeNull();
});

test("a waiting applicant sees the waiting screen, not the app", async () => {
  mockFetch({ "/api/me": waitingMeFixture });
  renderGate();
  expect(await screen.findByRole("heading", { name: "Welkom!" })).toBeVisible();
  expect(screen.queryByText("de app")).toBeNull();
});

test("the live stream is open while someone is logged in, and not on the login screen", async () => {
  const opened: string[] = [];
  const Original = globalThis.EventSource;
  globalThis.EventSource = class extends (Original as unknown as { new (): object }) {
    constructor(url: string) {
      super();
      opened.push(url);
    }
  } as unknown as typeof EventSource;
  try {
    mockFetch({ "/api/me": unauthorized() });
    const { unmount } = render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthGate>
          <p>de app</p>
        </AuthGate>
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Log in bij PadVinder" });
    expect(opened).toEqual([]);
    unmount();
    mockFetch({ "/api/me": waitingMeFixture });
    renderGate();
    await screen.findByRole("heading", { name: "Welkom!" });
    expect(opened).toEqual(["/api/events"]);
  } finally {
    globalThis.EventSource = Original;
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
  // What the previous user saw is gone, so the next one on this phone does not see it.
  expect(client.getQueryData(getHealthQueryKey())).toBeUndefined();
});

async function logIn() {
  await userEvent.type(await screen.findByLabelText("E-mailadres"), "noor@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  await userEvent.type(await screen.findByLabelText("Code"), "123456");
}

const authRoutes = {
  "/api/auth/email-otp/send-verification-otp": { success: true },
  "/api/auth/sign-in/email-otp": { user: { id: "u1", email: "noor@example.test" } },
};

test("logging in shows the app", async () => {
  const routes: Record<string, unknown> = { "/api/me": unauthorized(), ...authRoutes };
  mockFetch(routes);
  renderGate();
  await screen.findByRole("heading", { name: "Log in bij PadVinder" });
  routes["/api/me"] = meFixture;
  await logIn();
  expect(await screen.findByText("de app")).toBeVisible();
});

test("when /api/me fails right after logging in, the retry screen shows, not the login screen", async () => {
  const routes: Record<string, unknown> = { "/api/me": unauthorized(), ...authRoutes };
  mockFetch(routes);
  renderGate();
  await screen.findByRole("heading", { name: "Log in bij PadVinder" });
  routes["/api/me"] = new Response("boom", { status: 500 });
  await logIn();
  const retry = await screen.findByRole("button", { name: "Probeer opnieuw" });
  expect(screen.queryByRole("heading", { name: "Log in bij PadVinder" })).toBeNull();
  routes["/api/me"] = meFixture;
  await userEvent.click(retry);
  expect(await screen.findByText("de app")).toBeVisible();
});

test("logging in drops data cached before it", async () => {
  const routes: Record<string, unknown> = { "/api/me": unauthorized(), ...authRoutes };
  mockFetch(routes);
  const client = createTestQueryClient();
  client.setQueryData(getHealthQueryKey(), healthyFixture);
  renderGate(client);
  await screen.findByRole("heading", { name: "Log in bij PadVinder" });
  routes["/api/me"] = meFixture;
  await logIn();
  expect(await screen.findByText("de app")).toBeVisible();
  expect(client.getQueryData(getHealthQueryKey())).toBeUndefined();
});

test("a failed background refetch keeps the app", async () => {
  const routes: Record<string, unknown> = { "/api/me": meFixture };
  mockFetch(routes);
  const client = renderGate();
  expect(await screen.findByText("de app")).toBeVisible();
  routes["/api/me"] = new Response("boom", { status: 500 });
  await client.refetchQueries({ queryKey: getMeQueryKey() });
  expect(client.getQueryState(getMeQueryKey())?.status).toBe("error");
  expect(screen.getByText("de app")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Probeer opnieuw" })).toBeNull();
});
