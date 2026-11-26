import { applicantMeFixture, meFixture } from "@padvinder/contracts/fixtures";
import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { APP_VERSION } from "../app-version";
import { notLoggedIn, renderApp } from "../testing/render-app";
import { RootCrashBoundary } from "./crash";

const { captureCrash } = vi.hoisted(() => ({ captureCrash: vi.fn() }));
vi.mock("@padvinder/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@padvinder/ui")>()),
  captureCrash,
}));
vi.mock("../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

const crashEventId = "0123456789abcdef0123456789abcdef";
let restoreFetch: (() => void) | undefined;
beforeEach(() => {
  captureCrash.mockReset().mockReturnValue(crashEventId);
  // React logs every error a boundary caught.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  vi.restoreAllMocks();
});

function recordReports() {
  const bodies: unknown[] = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "POST" && new URL(request.url).pathname === "/api/problem-reports") {
      bodies.push(await request.clone().json());
    }
    return inner(request);
  };
  restoreFetch = () => (globalThis.fetch = inner);
  return bodies;
}

test("a crash in a screen shows the crash screen, reported once, and a report links to it", async () => {
  const bodies = recordReports();
  mockFetch({
    "/api/me": meFixture,
    "POST /api/problem-reports": new Response(null, { status: 204 }),
  });
  renderApp("/app/dev/crash");
  expect(await screen.findByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  expect(
    screen.getByText(
      "De app liep vast. Laad de app opnieuw. Gaat het weer mis? Vertel ons wat je deed.",
    ),
  ).toBeVisible();
  // Reported by the error element itself, with the thrown error; `captureCrash` sends each error
  // once, however often the element renders.
  const crashes = new Set(captureCrash.mock.calls.map(([error]) => error));
  expect(crashes.size).toBe(1);
  expect([...crashes][0]).toBeInstanceOf(Error);
  await userEvent.click(await screen.findByRole("button", { name: "Vertel wat er gebeurde" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Wat ging er mis?" }), "Ik tikte");
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  expect(await screen.findByText("Bedankt, je melding is verstuurd.")).toBeVisible();
  expect(bodies).toEqual([
    {
      message: "Ik tikte",
      includeContact: false,
      eventId: crashEventId,
      page: "/app/dev/crash",
      appVersion: APP_VERSION,
      app: "app",
    },
  ]);
});

test("a crash whose event was not sent sends a report without an event ID", async () => {
  captureCrash.mockReturnValue(undefined);
  const bodies = recordReports();
  mockFetch({
    "/api/me": meFixture,
    "POST /api/problem-reports": new Response(null, { status: 204 }),
  });
  renderApp("/app/dev/crash");
  await userEvent.click(await screen.findByRole("button", { name: "Vertel wat er gebeurde" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Wat ging er mis?" }), "Vast");
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  await screen.findByText("Bedankt, je melding is verstuurd.");
  expect(bodies).toEqual([expect.not.objectContaining({ eventId: expect.anything() })]);
});

test("an address without a screen is no crash to report", async () => {
  mockFetch({ "/api/me": meFixture });
  renderApp("/app/does-not-exist");
  expect(await screen.findByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  expect(captureCrash).not.toHaveBeenCalled();
});

function Crash(): never {
  throw new Error("crash outside the router");
}

function renderRootCrash() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RootCrashBoundary>
        <Crash />
      </RootCrashBoundary>
    </QueryClientProvider>,
  );
}

test("a crash outside the router before login shows only Laad opnieuw", async () => {
  mockFetch({ "/api/me": notLoggedIn() });
  renderRootCrash();
  expect(await screen.findByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Laad opnieuw" })).toBeVisible();
  // /api/me answered: still nobody to report for.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByRole("button", { name: "Vertel wat er gebeurde" })).toBeNull();
});

test("a crash outside the router while logged in offers the report, also to an applicant", async () => {
  mockFetch({ "/api/me": applicantMeFixture });
  renderRootCrash();
  expect(await screen.findByRole("button", { name: "Vertel wat er gebeurde" })).toBeVisible();
  // The root boundary is Sentry's; it reports the crash itself, not through captureCrash.
  expect(captureCrash).not.toHaveBeenCalled();
});
