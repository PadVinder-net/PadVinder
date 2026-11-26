import { applicantMeFixture, platformAdminMeFixture } from "@padvinder/contracts/fixtures";
import { createTestQueryClient, mockFetch } from "@padvinder/api-client/testing";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { renderPortal } from "../testing/render-portal";
import { errorResponse, recordRequests, requestsTo } from "../testing/requests";
import { RootCrashBoundary } from "./crash";

const { captureCrash } = vi.hoisted(() => ({ captureCrash: vi.fn() }));
vi.mock("@padvinder/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@padvinder/ui")>()),
  captureCrash,
}));

const crashEventId = "0123456789abcdef0123456789abcdef";
beforeEach(() => {
  captureCrash.mockReset().mockReturnValue(crashEventId);
  // React logs every error a boundary caught.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("a crash in a page shows the portal's crash screen, and a report links to its event", async () => {
  const requests = recordRequests();
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "POST /api/problem-reports": new Response(null, { status: 204 }),
  });
  renderPortal("/dev/crash");
  expect(await screen.findByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  expect(
    screen.getByText(
      "De pagina liep vast. Laad de pagina opnieuw. Gaat het weer mis? Vertel ons wat je deed.",
    ),
  ).toBeVisible();
  // The crash screen replaces the layout.
  expect(screen.queryByRole("button", { name: "Log uit" })).toBeNull();
  const crashes = new Set(captureCrash.mock.calls.map(([error]) => error));
  expect(crashes.size).toBe(1);
  await userEvent.click(await screen.findByRole("button", { name: "Vertel wat er gebeurde" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Wat ging er mis?" }), "Ik klikte");
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  // On the screen, not in a toast: the layout with the toaster is gone.
  expect(await screen.findByText("Bedankt, je melding is verstuurd.")).toBeVisible();
  expect(requestsTo(requests, "POST", "/api/problem-reports").map((r) => r.body)).toEqual([
    {
      message: "Ik klikte",
      includeContact: false,
      eventId: crashEventId,
      page: "/dev/crash",
      appVersion: "dev",
      app: "portal",
    },
  ]);
});

test("a failed report from the crash screen keeps the text", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "POST /api/problem-reports": errorResponse(429, "too_many_reports"),
  });
  renderPortal("/dev/crash");
  await userEvent.click(await screen.findByRole("button", { name: "Vertel wat er gebeurde" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Wat ging er mis?" }), "Weer");
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Je hebt in het afgelopen uur veel meldingen gestuurd.",
  );
  expect(screen.getByRole("textbox", { name: "Wat ging er mis?" })).toHaveValue("Weer");
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
  mockFetch({ "/api/me": errorResponse(401, "not_logged_in") });
  renderRootCrash();
  expect(await screen.findByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "Laad opnieuw",
  ]);
});

test("a crash outside the router while logged in offers the report", async () => {
  mockFetch({ "/api/me": applicantMeFixture });
  renderRootCrash();
  expect(await screen.findByRole("button", { name: "Vertel wat er gebeurde" })).toBeVisible();
  expect(captureCrash).not.toHaveBeenCalled();
});
