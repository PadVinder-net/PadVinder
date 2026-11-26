import { meFixture } from "@padvinder/contracts/fixtures";
import { mockFetch } from "@padvinder/api-client/testing";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { APP_VERSION } from "../../app-version";
import { errorResponse, renderApp } from "../../testing/render-app";

vi.mock("../../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

/** mockFetch has no request body access, so wrap fetch to record the reports. */
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

const message = () => screen.findByRole("textbox", { name: "Wat ging er mis?" });

test("Meld een probleem sends the report and goes back to Meer with thanks", async () => {
  const bodies = recordReports();
  mockFetch({
    "/api/me": meFixture,
    "/api/working-groups": { workingGroups: [] },
    "POST /api/problem-reports": new Response(null, { status: 204 }),
  });
  const { router } = renderApp("/app/more/report-problem");
  expect(await screen.findByRole("heading", { name: "Meld een probleem" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Terug" })).toHaveAttribute("href", "/app/more");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByText("Noor de Vries")).toBeVisible();
  expect(screen.getByText("noor@example.test")).toBeVisible();
  await userEvent.type(await message(), "De kaart blijft leeg");
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  expect(await screen.findByText("Bedankt, je melding is verstuurd.")).toBeVisible();
  expect(router.state.location.pathname).toBe("/app/more");
  expect(bodies).toEqual([
    {
      message: "De kaart blijft leeg",
      includeContact: true,
      page: "/app/more/report-problem",
      appVersion: APP_VERSION,
      app: "app",
    },
  ]);
});

test("a report that was not sent keeps the text and says why", async () => {
  mockFetch({
    "/api/me": meFixture,
    "POST /api/problem-reports": errorResponse(502, "report_not_sent"),
  });
  const { router } = renderApp("/app/more/report-problem");
  await userEvent.type(await message(), "De kaart blijft leeg");
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Je melding is niet verstuurd. Probeer het zo nog eens.",
  );
  expect(await message()).toHaveValue("De kaart blijft leeg");
  expect(router.state.location.pathname).toBe("/app/more/report-problem");
});

test("too many reports says so", async () => {
  mockFetch({
    "/api/me": meFixture,
    "POST /api/problem-reports": errorResponse(429, "too_many_reports"),
  });
  renderApp("/app/more/report-problem");
  await userEvent.type(await message(), "Nog een keer");
  await userEvent.click(screen.getByRole("button", { name: "Verstuur" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Je hebt in het afgelopen uur veel meldingen gestuurd.",
  );
});
