import { meFixture } from "@padvinder/contracts/fixtures";
import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
import { startBrowserMonitoring, stopBrowserMonitoring } from "@padvinder/ui";
import * as Sentry from "@sentry/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthGate } from "../auth/auth-gate";
import { appBasename, routes } from "../router";
import { RootCrashBoundary } from "./crash";

// The real browser SDK with a transport that keeps the envelopes: a crash is one error event,
// whichever boundary catches it, also in strict mode.

vi.mock("../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

type Transport = ReturnType<NonNullable<Sentry.BrowserOptions["transport"]>>;
type Envelope = Parameters<Transport["send"]>[0];

let envelopes: Envelope[] = [];
let restoreFetch: (() => void) | undefined;

beforeEach(() => {
  envelopes = [];
  startBrowserMonitoring({
    app: "app",
    appVersion: "2027.1.0",
    release: "abc123",
    enabled: true,
    transport: () => ({
      send: async (envelope) => {
        envelopes.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  // React logs every error a boundary caught.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  restoreFetch?.();
  restoreFetch = undefined;
  vi.restoreAllMocks();
  await stopBrowserMonitoring();
});

/** The error events sent so far, after a flush. */
async function errorEvents(): Promise<Array<{ event_id?: string }>> {
  await Sentry.flush(2000);
  return envelopes.flatMap(([, items]) =>
    items
      .filter(([header]) => header.type === "event")
      .map(([, payload]) => payload as { event_id?: string }),
  );
}

function recordReports() {
  const bodies: Array<{ eventId?: string }> = [];
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

/** As `main.tsx` mounts the app: strict mode, the root boundary, the gate and the router. */
function renderAsMain(path: string, inner?: ReactNode) {
  const router = createMemoryRouter(routes, { basename: appBasename, initialEntries: [path] });
  render(
    <StrictMode>
      <QueryClientProvider client={createTestQueryClient()}>
        <RootCrashBoundary>
          {inner ?? (
            <AuthGate>
              <RouterProvider router={router} />
            </AuthGate>
          )}
        </RootCrashBoundary>
      </QueryClientProvider>
    </StrictMode>,
  );
}

async function sendReport() {
  await userEvent.click(await screen.findByRole("button", { name: "Vertel wat er gebeurde" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Wat ging er mis?" }), "Vast");
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  await screen.findByText("Bedankt, je melding is verstuurd.");
}

test("a crash in a screen is one error event, and the report links to it", async () => {
  const bodies = recordReports();
  mockFetch({
    "/api/me": meFixture,
    "POST /api/problem-reports": new Response(null, { status: 204 }),
  });
  renderAsMain("/app/dev/crash");
  expect(await screen.findByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  const events = await errorEvents();
  expect(events).toHaveLength(1);
  await sendReport();
  expect(bodies).toEqual([expect.objectContaining({ eventId: events[0]!.event_id })]);
});

function Crash(): never {
  throw new Error("crash outside the router");
}

test("a crash outside the router is one error event; a later error does not unlink the report", async () => {
  const bodies = recordReports();
  mockFetch({
    "/api/me": meFixture,
    "POST /api/problem-reports": new Response(null, { status: 204 }),
  });
  renderAsMain("/app/", <Crash />);
  expect(await screen.findByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  const events = await errorEvents();
  expect(events).toHaveLength(1);
  Sentry.captureException(new Error("a later error"));
  await sendReport();
  expect(bodies).toEqual([expect.objectContaining({ eventId: events[0]!.event_id })]);
});
