import { mockFetch } from "@padvinder/api-client/testing";
import type { AuditLogEntry, MeResponse } from "@padvinder/contracts";
import {
  applicantMeFixture,
  auditLogFixture,
  coordinatorMeFixture,
  organizationsFixture,
  platformAdminMeFixture,
  twoOrganizationsMeFixture,
} from "@padvinder/contracts/fixtures";
import { auditLogSentence, formatDateTime } from "@padvinder/ui";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";
import {
  answerRequests,
  emitAccessChanged,
  errorResponse,
  holdRequests,
  neverAnswer,
  recordRequests,
  requestsTo,
} from "../testing/requests";

beforeAll(() => {
  // jsdom lacks what Radix's select uses to open and scroll its list.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const logPath = "/api/audit-log-entries";
const connection = "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.";
const [fictiefdorp, voorbeeldstad] = organizationsFixture as [
  (typeof organizationsFixture)[number],
  (typeof organizationsFixture)[number],
];

/** An admin of one organization, without any membership. */
const organizationAdminMe: MeResponse = {
  ...applicantMeFixture,
  organizationAdminOf: twoOrganizationsMeFixture.organizationAdminOf,
};

/** An admin of two organizations, without any membership. */
const twoOrganizationAdminMe: MeResponse = {
  ...applicantMeFixture,
  organizationAdminOf: [
    { id: fictiefdorp.id, name: fictiefdorp.name },
    { id: voorbeeldstad.id, name: voorbeeldstad.name },
  ],
};

/**
 * A client whose retries come at once: `useAuditLog` retries a failed load three times, and the
 * default pauses between them would last seconds.
 */
function quickRetryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
}

/** Answers the audit log with `answer(url)`, and keeps every URL it was asked with. */
function mockLog(me: MeResponse, answer: (url: URL) => Response | Promise<Response>) {
  mockFetch({ "/api/me": me, "/api/organizations": { organizations: organizationsFixture } });
  const urls: URL[] = [];
  answerRequests(
    (url) => url.pathname === logPath,
    (url) => {
      urls.push(url);
      return answer(url);
    },
  );
  return { urls, client: quickRetryClient() };
}

const page = (entries: AuditLogEntry[], nextCursor: string | null = null) =>
  Response.json({ entries, nextCursor });

const rows = () => screen.getAllByRole("row").slice(1);
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
const headings = () => screen.getAllByRole("columnheader").map((cell) => cell.textContent);

async function expectNotFound() {
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
}

async function optionsOf(combobox: string) {
  await userEvent.click(screen.getByRole("combobox", { name: combobox }));
  const options = screen.getAllByRole("option").map((option) => option.textContent);
  await userEvent.keyboard("{Escape}");
  return options;
}

async function choose(combobox: string, option: string) {
  await userEvent.click(screen.getByRole("combobox", { name: combobox }));
  await userEvent.click(screen.getByRole("option", { name: option }));
}

test("shows when, who and what for each entry", async () => {
  const { client } = mockLog(platformAdminMeFixture, () => page(auditLogFixture));
  renderPortal("/audit-log", client);
  expect(await screen.findByRole("heading", { level: 1, name: "Logboek" })).toBeVisible();
  await screen.findByRole("cell", { name: "Organisatie toegevoegd: Paddentrek Voorbeeldstad" });
  expect(rows()).toHaveLength(auditLogFixture.length);
  const approved = auditLogFixture.find((entry) => entry.action === "membership_request.approved")!;
  const row = screen
    .getByRole("cell", { name: "Aanmelding goedgekeurd: Vrijwilliger Noord bij Noord" })
    .closest("tr")!;
  expect(cells(row).slice(0, 3)).toEqual([
    formatDateTime(approved.occurredAt),
    "Coördinator Noord",
    "Aanmelding goedgekeurd: Vrijwilliger Noord bij Noord",
  ]);
  // Newest first, as the API sends them.
  expect(cells(rows()[0]!)[2]).toBe("safety_test.published");
  expect(cells(rows().at(-1)!)[2]).toBe("Organisatie toegevoegd: Paddentrek Voorbeeldstad");
});

test("while the log loads, the page says so", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture, "/api/organizations": { organizations: [] } });
  neverAnswer((request) => new URL(request.url).pathname === logPath);
  renderPortal("/audit-log");
  expect(await screen.findByText("Logboek laden…")).toBeVisible();
  expect(screen.getByRole("heading", { level: 1, name: "Logboek" })).toBeVisible();
});

test("a failed load shows the connection text, and Probeer opnieuw loads again", async () => {
  let fail = true;
  const { client } = mockLog(platformAdminMeFixture, () =>
    fail ? new Response("boom", { status: 500 }) : page(auditLogFixture.slice(0, 1)),
  );
  renderPortal("/audit-log", client);
  expect(await screen.findByText(connection)).toBeVisible();
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(await screen.findByRole("cell", { name: "safety_test.published" })).toBeVisible();
});

test("an admin of one organization sees no organization filter, no Organisatie column, and no Accounts or Soorten among the actions", async () => {
  const requests = recordRequests();
  const { client } = mockLog(organizationAdminMe, () => page(auditLogFixture));
  renderPortal("/audit-log", client);
  await screen.findByRole("cell", { name: "safety_test.published" });
  expect(screen.queryByRole("combobox", { name: "Organisatie" })).toBeNull();
  expect(headings()).toEqual(["Wanneer", "Wie", "Wat"]);
  expect(await optionsOf("Actie")).toEqual([
    "Alle acties",
    "Organisaties",
    "Werkgroepen",
    "Rollen",
    "Leden en aanmeldingen",
  ]);
  // Its organizations come from me, not from the platform admins' list.
  expect(requestsTo(requests, "GET", "/api/organizations")).toEqual([]);
});

test("an admin of two organizations filters on them, from me", async () => {
  const requests = recordRequests();
  const { client } = mockLog(twoOrganizationAdminMe, () => page(auditLogFixture));
  renderPortal("/audit-log", client);
  await screen.findByRole("cell", { name: "safety_test.published" });
  expect(await optionsOf("Organisatie")).toEqual([
    "Alle organisaties",
    fictiefdorp.name,
    voorbeeldstad.name,
  ]);
  expect(headings()).toEqual(["Wanneer", "Wie", "Wat", "Organisatie"]);
  expect(requestsTo(requests, "GET", "/api/organizations")).toEqual([]);
});

test("a platform admin chooses an organization and an action, and the request holds both and no cursor", async () => {
  const { urls, client } = mockLog(platformAdminMeFixture, () =>
    page(auditLogFixture.slice(0, 3), "c1"),
  );
  renderPortal("/audit-log", client);
  await screen.findByRole("cell", { name: "safety_test.published" });
  expect(await optionsOf("Actie")).toEqual([
    "Alle acties",
    "Organisaties",
    "Werkgroepen",
    "Rollen",
    "Leden en aanmeldingen",
    "Accounts",
    "Soorten",
  ]);
  // More than one organization and none chosen: the column shows.
  expect(headings()).toEqual(["Wanneer", "Wie", "Wat", "Organisatie"]);
  await choose("Organisatie", voorbeeldstad.name);
  await waitFor(() =>
    expect(urls.at(-1)!.searchParams.get("organizationId")).toBe(voorbeeldstad.id),
  );
  await choose("Actie", "Rollen");
  await waitFor(() => expect(urls.at(-1)!.searchParams.get("actionGroup")).toBe("role"));
  const last = urls.at(-1)!;
  expect(last.searchParams.get("organizationId")).toBe(voorbeeldstad.id);
  expect(last.searchParams.has("cursor")).toBe(false);
  // One organization chosen: no column.
  await screen.findByRole("cell", { name: "safety_test.published" });
  expect(headings()).toEqual(["Wanneer", "Wie", "Wat"]);
});

test("Laad meer asks with the cursor and adds the rows below the ones that were there, each once", async () => {
  const first = auditLogFixture.slice(0, 2);
  const second = auditLogFixture.slice(2, 4);
  const { urls, client } = mockLog(platformAdminMeFixture, (url) =>
    url.searchParams.get("cursor") === "c1" ? page(second) : page(first, "c1"),
  );
  renderPortal("/audit-log", client);
  await screen.findByRole("cell", { name: "safety_test.published" });
  expect(rows()).toHaveLength(2);
  const release = holdRequests((request) => new URL(request.url).searchParams.has("cursor"));
  await userEvent.click(screen.getByRole("button", { name: "Laad meer" }));
  // While it loads, the button waits.
  expect(await screen.findByRole("button", { name: "Even geduld…" })).toBeDisabled();
  release();
  await waitFor(() => expect(rows()).toHaveLength(4));
  expect(rows().map((row) => cells(row)[2])).toEqual([...first, ...second].map(auditLogSentence));
  expect(urls.map((url) => url.searchParams.get("cursor"))).toEqual([null, "c1"]);
  // No next cursor: nothing more to load.
  expect(screen.queryByRole("button", { name: "Laad meer" })).toBeNull();
  // Each entry once.
  const shown = rows().map((row) => cells(row).join("|"));
  expect(new Set(shown).size).toBe(4);
});

test("without a next cursor there is no Laad meer", async () => {
  const { client } = mockLog(platformAdminMeFixture, () => page(auditLogFixture));
  renderPortal("/audit-log", client);
  await screen.findByRole("cell", { name: "safety_test.published" });
  expect(screen.queryByRole("button", { name: "Laad meer" })).toBeNull();
});

test("a failed Laad meer shows the connection text as a toast and keeps the rows", async () => {
  const first = auditLogFixture.slice(0, 2);
  let fail = true;
  const { urls, client } = mockLog(platformAdminMeFixture, (url) =>
    url.searchParams.get("cursor") === "c1"
      ? fail
        ? new Response("boom", { status: 500 })
        : page(auditLogFixture.slice(2, 3))
      : page(first, "c1"),
  );
  renderPortal("/audit-log", client);
  await screen.findByRole("cell", { name: "safety_test.published" });
  await userEvent.click(screen.getByRole("button", { name: "Laad meer" }));
  expect(await screen.findByText(connection)).toBeVisible();
  // The rows stay, and the button works again.
  const again = await screen.findByRole("button", { name: "Laad meer" });
  expect(again).toBeEnabled();
  expect(rows()).toHaveLength(2);
  // One toast for the failure, also though the hook tried more than once.
  expect(urls.filter((url) => url.searchParams.get("cursor") === "c1").length).toBeGreaterThan(1);
  expect(screen.getAllByText(connection)).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Probeer opnieuw" })).toBeNull();

  fail = false;
  await userEvent.click(again);
  await waitFor(() => expect(rows()).toHaveLength(3));
});

test("a second failed Laad meer shows the toast again", async () => {
  const { client } = mockLog(platformAdminMeFixture, (url) =>
    url.searchParams.get("cursor") === "c1"
      ? new Response("boom", { status: 500 })
      : page(auditLogFixture.slice(0, 2), "c1"),
  );
  renderPortal("/audit-log", client);
  await screen.findByRole("cell", { name: "safety_test.published" });
  await userEvent.click(screen.getByRole("button", { name: "Laad meer" }));
  expect(await screen.findByText(connection)).toBeVisible();
  await userEvent.click(await screen.findByRole("button", { name: "Laad meer" }));
  await waitFor(() => expect(screen.getAllByText(connection)).toHaveLength(2));
});

test("an entry with an unknown action shows that action's text", async () => {
  const unknown: AuditLogEntry = {
    ...auditLogFixture[1]!,
    id: "0192f3c0-0000-7000-8000-000000000f01",
    action: "drain.registered",
    details: {},
  };
  const { client } = mockLog(platformAdminMeFixture, () => page([unknown]));
  renderPortal("/audit-log", client);
  expect(await screen.findByRole("cell", { name: "drain.registered" })).toBeVisible();
});

test("a coordinator who opens /audit-log sees the not-found page, and no request for the log was made", async () => {
  const requests = recordRequests();
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/managed-working-groups": { workingGroups: [] },
  });
  renderPortal("/audit-log");
  await expectNotFound();
  expect(requestsTo(requests, "GET", logPath)).toEqual([]);
  expect(screen.queryByRole("heading", { level: 1, name: "Logboek" })).toBeNull();
});

test("when an admin loses the role while the page is open, it turns into the not-found page", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": organizationAdminMe,
    "/api/managed-working-groups": { workingGroups: [] },
  };
  mockFetch(routes);
  answerRequests(
    (url) => url.pathname === logPath,
    () => page(auditLogFixture),
  );
  renderPortal("/audit-log", quickRetryClient());
  await screen.findByRole("cell", { name: "safety_test.published" });
  routes["/api/me"] = applicantMeFixture;
  emitAccessChanged(organizationAdminMe.user.id);
  await expectNotFound();
});

test("when the chosen organization answers 404, the filter goes back to Alle organisaties", async () => {
  const { urls, client } = mockLog(twoOrganizationAdminMe, (url) =>
    url.searchParams.get("organizationId") === voorbeeldstad.id
      ? errorResponse(404, "not_found")
      : page(auditLogFixture),
  );
  renderPortal("/audit-log", client);
  await screen.findByRole("cell", { name: "safety_test.published" });
  await choose("Organisatie", voorbeeldstad.name);
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Organisatie" })).toHaveTextContent(
      "Alle organisaties",
    ),
  );
  // Asked once for the organization (a 404 is not retried), then for all of them again.
  expect(
    urls.filter((url) => url.searchParams.get("organizationId") === voorbeeldstad.id),
  ).toHaveLength(1);
  expect(urls.at(-1)!.searchParams.has("organizationId")).toBe(false);
  expect(screen.getByRole("cell", { name: "safety_test.published" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Probeer opnieuw" })).toBeNull();
});
