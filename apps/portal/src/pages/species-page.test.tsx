import { mockFetch } from "@padvinder/api-client/testing";
import { meFixture, platformAdminMeFixture, speciesFixture } from "@padvinder/contracts/fixtures";
import type { Species } from "@padvinder/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";

type RecordedRequest = { method: string; path: string; body: unknown };

let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

/** mockFetch keeps only paths, so wrap fetch to record every request with its method and JSON body. */
function recordRequests() {
  const requests: RecordedRequest[] = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.clone().text();
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: text === "" ? undefined : JSON.parse(text),
    });
    return inner(request);
  };
  restoreFetch = () => (globalThis.fetch = inner);
  return requests;
}

/**
 * Holds back every request that `match` picks until the test calls `release`, so the test can act
 * while a save runs.
 */
function holdRequests(match: (request: Request) => boolean) {
  const inner = globalThis.fetch;
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (match(request)) await released;
    return inner(request);
  };
  restoreFetch = () => (globalThis.fetch = inner);
  return release;
}

const isPatch = (request: Request) => request.method === "PATCH";

const speciesRequests = (requests: RecordedRequest[], method: string) =>
  requests.filter(
    (request) => request.method === method && request.path.startsWith("/api/species"),
  );

function errorResponse(status: number, code: string, issues?: { path: string; message: string }[]) {
  return Response.json(
    { statusCode: status, error: "Error", message: "x", code, ...(issues ? { issues } : {}) },
    { status },
  );
}

const newSpecies: Species = {
  id: "0192f3c0-0000-7000-8000-0000000000aa",
  dutchName: "vroedmeesterpad",
  scientificName: "Alytes obstetricans",
  needsVerification: false,
  active: true,
};

const gewonePad = speciesFixture[1]!;
const kamsalamander = speciesFixture[3]!;
const vuursalamander = speciesFixture[5]!;

async function rowOf(name: string) {
  return (await screen.findByRole("cell", { name })).closest("tr")!;
}

async function fillNewSpecies() {
  await userEvent.type(screen.getByLabelText("Nederlandse naam"), newSpecies.dutchName);
  await userEvent.type(screen.getByLabelText("Wetenschappelijke naam"), newSpecies.scientificName);
}

test("shows the species in the given order", async () => {
  const reversed = [...speciesFixture].reverse();
  mockFetch({ "/api/me": platformAdminMeFixture, "/api/species": { species: reversed } });
  renderPortal("/species");
  expect(await screen.findByRole("heading", { level: 1, name: "Soorten" })).toBeVisible();
  await screen.findByRole("cell", { name: "Gewone pad" });
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows.map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual([
    "Vuursalamander",
    "Kleine watersalamander",
    "Kamsalamander",
    "Groene kikker",
    "Gewone pad",
    "Bruine kikker",
  ]);
  expect(screen.getByRole("button", { name: "Nieuwe soort" })).toBeVisible();
});

test("while the species load, the page says so", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture });
  const inner = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    new Request(input, init).url.endsWith("/api/species")
      ? new Promise<Response>(() => {})
      : inner(input, init);
  restoreFetch = () => (globalThis.fetch = inner);
  renderPortal("/species");
  expect(await screen.findByText("Soorten laden…")).toBeVisible();
  expect(screen.getByRole("heading", { level: 1, name: "Soorten" })).toBeVisible();
});

test("a failed load says so and Probeer opnieuw loads again", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    "/api/species": new Response("boom", { status: 500 }),
  };
  mockFetch(routes);
  renderPortal("/species");
  expect(
    await screen.findByText("Het lukt nu niet. Controleer je verbinding en probeer het opnieuw."),
  ).toBeVisible();
  routes["/api/species"] = { species: speciesFixture };
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(await screen.findByRole("cell", { name: "Gewone pad" })).toBeVisible();
});

test("adding a species closes the modal, shows the toast and refetches", async () => {
  const requests = recordRequests();
  const routes: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    "POST /api/species": Response.json(newSpecies, { status: 201 }),
  };
  mockFetch(routes);
  renderPortal("/species");
  await screen.findByRole("cell", { name: "Gewone pad" });
  routes["GET /api/species"] = { species: [...speciesFixture, newSpecies] };
  await userEvent.click(screen.getByRole("button", { name: "Nieuwe soort" }));
  const dialog = await screen.findByRole("dialog", { name: "Nieuwe soort" });
  await fillNewSpecies();
  await userEvent.click(within(dialog).getByRole("checkbox"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Vroedmeesterpad is toegevoegd.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(speciesRequests(requests, "POST").map((request) => request.body)).toEqual([
    {
      dutchName: newSpecies.dutchName,
      scientificName: newSpecies.scientificName,
      needsVerification: true,
    },
  ]);
  expect(await screen.findByRole("cell", { name: "Vroedmeesterpad" })).toBeVisible();
  expect(speciesRequests(requests, "GET")).toHaveLength(2);
});

test("a taken scientific name keeps the modal open with the text under that field", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    "POST /api/species": errorResponse(409, "name_taken", [
      { path: "scientificName", message: "taken" },
    ]),
  });
  renderPortal("/species");
  await userEvent.click(await screen.findByRole("button", { name: "Nieuwe soort" }));
  const dialog = await screen.findByRole("dialog", { name: "Nieuwe soort" });
  await fillNewSpecies();
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  const message = "Er is al een soort met deze wetenschappelijke naam.";
  expect(await within(dialog).findByText(message)).toBeVisible();
  expect(within(dialog).getByLabelText("Wetenschappelijke naam")).toHaveAccessibleDescription(
    message,
  );
  expect(within(dialog).getByLabelText("Nederlandse naam")).not.toHaveAttribute("aria-invalid");
  expect(screen.getByRole("dialog", { name: "Nieuwe soort" })).toBeVisible();
});

test("any other failure shows the Dutch text in the form, and a reopened form starts clean", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    "POST /api/species": errorResponse(403, "not_allowed"),
  });
  renderPortal("/species");
  await userEvent.click(await screen.findByRole("button", { name: "Nieuwe soort" }));
  let dialog = await screen.findByRole("dialog", { name: "Nieuwe soort" });
  await fillNewSpecies();
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await within(dialog).findByText("Dit mag je niet doen.")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(screen.getByRole("button", { name: "Nieuwe soort" }));
  dialog = await screen.findByRole("dialog", { name: "Nieuwe soort" });
  expect(within(dialog).queryByText("Dit mag je niet doen.")).toBeNull();
  expect(within(dialog).getByLabelText("Nederlandse naam")).toHaveValue("");
});

test("editing starts with the species' values", async () => {
  const requests = recordRequests();
  const renamed = { ...kamsalamander, dutchName: "kamsalamander (groot)" };
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    [`PATCH /api/species/${kamsalamander.id}`]: renamed,
  });
  renderPortal("/species");
  const row = await rowOf("Kamsalamander");
  await userEvent.click(within(row).getByRole("button", { name: "Wijzig" }));
  const dialog = await screen.findByRole("dialog", { name: "Soort wijzigen" });
  const dutchName = within(dialog).getByLabelText("Nederlandse naam");
  expect(dutchName).toHaveValue("kamsalamander");
  expect(within(dialog).getByLabelText("Wetenschappelijke naam")).toHaveValue("Triturus cristatus");
  expect(within(dialog).getByRole("checkbox")).toBeChecked();
  await userEvent.clear(dutchName);
  await userEvent.type(dutchName, renamed.dutchName);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Kamsalamander (groot) is gewijzigd.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(speciesRequests(requests, "PATCH")).toEqual([
    {
      method: "PATCH",
      path: `/api/species/${kamsalamander.id}`,
      body: { dutchName: renamed.dutchName },
    },
  ]);

  // Another species opens with its own values, not the ones typed before.
  await userEvent.click(within(await rowOf("Gewone pad")).getByRole("button", { name: "Wijzig" }));
  const second = await screen.findByRole("dialog", { name: "Soort wijzigen" });
  expect(within(second).getByLabelText("Nederlandse naam")).toHaveValue("gewone pad");
  expect(within(second).getByRole("checkbox")).not.toBeChecked();
});

test("an edit sends only the fields that changed, comparing names as the server stores them", async () => {
  const requests = recordRequests();
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    [`PATCH /api/species/${kamsalamander.id}`]: { ...kamsalamander, needsVerification: false },
  });
  renderPortal("/species");
  await userEvent.click(
    within(await rowOf("Kamsalamander")).getByRole("button", { name: "Wijzig" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Soort wijzigen" });
  const scientificName = within(dialog).getByLabelText("Wetenschappelijke naam");
  await userEvent.clear(scientificName);
  await userEvent.type(scientificName, "  Triturus   cristatus ");
  await userEvent.click(within(dialog).getByRole("checkbox"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Kamsalamander is gewijzigd.")).toBeVisible();
  expect(speciesRequests(requests, "PATCH").map((request) => request.body)).toEqual([
    { needsVerification: false },
  ]);
});

test("saving an unchanged form sends nothing, closes the modal and shows no toast", async () => {
  const requests = recordRequests();
  mockFetch({ "/api/me": platformAdminMeFixture, "GET /api/species": { species: speciesFixture } });
  renderPortal("/species");
  await userEvent.click(within(await rowOf("Gewone pad")).getByRole("button", { name: "Wijzig" }));
  const dialog = await screen.findByRole("dialog", { name: "Soort wijzigen" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(speciesRequests(requests, "PATCH")).toEqual([]);
  expect(screen.queryByText(/is gewijzigd/)).toBeNull();
});

test("while a save runs, Escape and the cross do not close the modal; the answer shows after", async () => {
  const renamed = { ...kamsalamander, dutchName: "kamsalamander (groot)" };
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    [`PATCH /api/species/${kamsalamander.id}`]: renamed,
  });
  const release = holdRequests(isPatch);
  renderPortal("/species");
  await userEvent.click(
    within(await rowOf("Kamsalamander")).getByRole("button", { name: "Wijzig" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Soort wijzigen" });
  const dutchName = within(dialog).getByLabelText("Nederlandse naam");
  await userEvent.clear(dutchName);
  await userEvent.type(dutchName, renamed.dutchName);
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Even geduld…" })).toBeVisible(),
  );
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(dialog).getByRole("button", { name: "Sluiten" }));
  expect(screen.getByRole("dialog", { name: "Soort wijzigen" })).toBeVisible();

  release();
  expect(await screen.findByText("Kamsalamander (groot) is gewijzigd.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("while Zet uit runs, Escape does not close the question; a failure shows in it after", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    [`PATCH /api/species/${gewonePad.id}`]: new Response("boom", { status: 502 }),
  });
  const release = holdRequests(isPatch);
  renderPortal("/species");
  await userEvent.click(within(await rowOf("Gewone pad")).getByRole("button", { name: "Zet uit" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Gewone pad uitzetten?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Zet uit" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Even geduld…" })).toBeVisible(),
  );
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("alertdialog", { name: "Gewone pad uitzetten?" })).toBeVisible();

  release();
  expect(
    await within(dialog).findByText(
      "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("alertdialog", { name: "Gewone pad uitzetten?" })).toBeVisible();
});

test("Zet uit asks first; Annuleer changes nothing; confirming sends active false", async () => {
  const requests = recordRequests();
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    [`PATCH /api/species/${gewonePad.id}`]: { ...gewonePad, active: false },
  });
  renderPortal("/species");
  const row = await rowOf("Gewone pad");
  await userEvent.click(within(row).getByRole("button", { name: "Zet uit" }));
  let dialog = await screen.findByRole("alertdialog", { name: "Gewone pad uitzetten?" });
  expect(
    within(dialog).getByText(
      "Vrijwilligers kunnen deze soort dan niet meer kiezen. Eerdere tellingen blijven bewaard.",
    ),
  ).toBeVisible();
  await userEvent.click(within(dialog).getByRole("button", { name: "Annuleer" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(speciesRequests(requests, "PATCH")).toEqual([]);

  await userEvent.click(within(row).getByRole("button", { name: "Zet uit" }));
  dialog = await screen.findByRole("alertdialog", { name: "Gewone pad uitzetten?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Zet uit" }));
  expect(await screen.findByText("Gewone pad staat uit.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(speciesRequests(requests, "PATCH")).toEqual([
    { method: "PATCH", path: `/api/species/${gewonePad.id}`, body: { active: false } },
  ]);
});

test("Zet uit that fails keeps the question open with the Dutch text", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    [`PATCH /api/species/${gewonePad.id}`]: new Response("boom", { status: 502 }),
  });
  renderPortal("/species");
  await userEvent.click(within(await rowOf("Gewone pad")).getByRole("button", { name: "Zet uit" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Gewone pad uitzetten?" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Zet uit" }));
  expect(
    await within(dialog).findByText(
      "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.",
    ),
  ).toBeVisible();
  expect(screen.queryByText("Gewone pad staat uit.")).toBeNull();
});

test("Zet aan sends active true without asking", async () => {
  const requests = recordRequests();
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    [`PATCH /api/species/${vuursalamander.id}`]: { ...vuursalamander, active: true },
  });
  renderPortal("/species");
  const row = await rowOf("Vuursalamander");
  await userEvent.click(within(row).getByRole("button", { name: "Zet aan" }));
  expect(await screen.findByText("Vuursalamander staat aan.")).toBeVisible();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(speciesRequests(requests, "PATCH")).toEqual([
    { method: "PATCH", path: `/api/species/${vuursalamander.id}`, body: { active: true } },
  ]);
});

test("Zet aan that fails says so in a toast", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "GET /api/species": { species: speciesFixture },
    [`PATCH /api/species/${vuursalamander.id}`]: errorResponse(404, "not_found"),
  });
  renderPortal("/species");
  await userEvent.click(
    within(await rowOf("Vuursalamander")).getByRole("button", { name: "Zet aan" }),
  );
  expect(await screen.findByText("Dit bestaat niet meer.")).toBeVisible();
  expect(screen.queryByText("Vuursalamander staat aan.")).toBeNull();
});

test("a volunteer sees the not-found page and no request for species is needed for that", async () => {
  const { calls } = mockFetch({ "/api/me": meFixture });
  renderPortal("/species");
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Soorten" })).toBeNull();
  expect(calls).not.toContain("/api/species");
});
