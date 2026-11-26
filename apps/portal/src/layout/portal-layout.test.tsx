import { FakeEventSource, mockFetch } from "@padvinder/api-client/testing";
import {
  coordinatorMeFixture,
  healthyFixture,
  managedWorkingGroupsFixture,
  meFixture,
  platformAdminMeFixture,
  speciesFixture,
} from "@padvinder/contracts/fixtures";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";
import { errorResponse, recordRequests, requestsTo } from "../testing/requests";

/** What the server sends when someone's rights changed; the layout then asks /api/me again. */
function emitAccessChanged(userId: string) {
  act(() => {
    for (const source of FakeEventSource.instances)
      source.emit("access-changed", JSON.stringify({ type: "access-changed", userId }));
  });
}

/** The managed working groups without any open request. */
const withoutOpenRequests = managedWorkingGroupsFixture.map((group) => ({
  ...group,
  pendingRequestCount: 0,
}));

test("the layout shows the items, the name and Log uit", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "/api/health": healthyFixture,
    "/api/managed-working-groups": { workingGroups: withoutOpenRequests },
  });
  renderPortal("/system");
  const navigation = await screen.findByRole("navigation", { name: "Beheer" });
  const links = within(navigation).getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual([
    "Werkgroepen",
    "Aanmeldingen",
    "Organisaties",
    "Soorten",
    "Logboek",
    "Hoofdbeheerders",
    "Account verwijderen",
    "Systeemstatus",
  ]);
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "/working-groups",
    "/membership-requests",
    "/organizations",
    "/species",
    "/audit-log",
    "/platform-admins",
    "/delete-account",
    "/system",
  ]);
  expect(screen.getByText("PadVinder")).toBeVisible();
  expect(screen.getByText(platformAdminMeFixture.user.name)).toBeVisible();
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
  expect(await screen.findByRole("heading", { level: 1, name: "Systeemstatus" })).toBeVisible();
});

test("the layout shows the number of open requests, and nothing at zero", async () => {
  const routesByUrl: Record<string, unknown> = {
    "/api/me": coordinatorMeFixture,
    // Noord has two open requests, the other groups none.
    "/api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
  };
  mockFetch(routesByUrl);
  renderPortal("/working-groups");
  const link = await screen.findByRole("link", { name: "Aanmeldingen, 2 open" });
  expect(link).toHaveAttribute("href", "/membership-requests");
  expect(within(link).getByText("2")).toBeVisible();

  routesByUrl["/api/managed-working-groups"] = { workingGroups: withoutOpenRequests };
  emitAccessChanged(coordinatorMeFixture.user.id);
  const plain = await screen.findByRole("link", { name: "Aanmeldingen" });
  expect(plain.textContent).toBe("Aanmeldingen");
});

test("a volunteer's layout does not ask for the managed working groups", async () => {
  mockFetch({ "/api/me": meFixture });
  const requests = recordRequests();
  renderPortal("/");
  expect(await screen.findByText(meFixture.user.name)).toBeVisible();
  expect(requestsTo(requests, "GET", "/api/managed-working-groups")).toEqual([]);
});

test("the current item is marked as the current page, not only by color", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture, "/api/health": healthyFixture });
  renderPortal("/system");
  const current = await screen.findByRole("link", { name: "Systeemstatus" });
  expect(current).toHaveAttribute("aria-current", "page");
  expect(current).toHaveClass("underline");
  const other = screen.getByRole("link", { name: "Soorten" });
  expect(other).not.toHaveAttribute("aria-current");
  expect(other).not.toHaveClass("underline");
});

test("someone without items sees no navigation, but the name and Log uit", async () => {
  mockFetch({ "/api/me": meFixture });
  renderPortal("/");
  expect(await screen.findByText(meFixture.user.name)).toBeVisible();
  expect(screen.queryByRole("navigation", { name: "Beheer" })).toBeNull();
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
});

test("the layout opens the live stream", async () => {
  mockFetch({ "/api/me": meFixture });
  renderPortal("/");
  await screen.findByText(meFixture.user.name);
  expect(FakeEventSource.instances.map((source) => source.url)).toEqual(["/api/events"]);
});

test("when me changes to a platform admin, the items appear without a reload", async () => {
  const routesByUrl: Record<string, unknown> = {
    "/api/me": meFixture,
    // Home sends a platform admin on to the working groups.
    "/api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
  };
  mockFetch(routesByUrl);
  renderPortal("/");
  expect(
    await screen.findByText(
      "Het portaal is voor coördinatoren en beheerders. Tellen doe je in de app.",
    ),
  ).toBeVisible();
  routesByUrl["/api/me"] = platformAdminMeFixture;
  emitAccessChanged(meFixture.user.id);
  const navigation = await screen.findByRole("navigation", { name: "Beheer" });
  expect(within(navigation).getByRole("link", { name: "Soorten" })).toBeVisible();
  expect(within(navigation).getByRole("link", { name: "Systeemstatus" })).toBeVisible();
  expect(await screen.findByRole("button", { name: "Noord" })).toBeVisible();
});

test("when a platform admin loses the flag, an open /system turns into not found", async () => {
  const routesByUrl: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    "/api/health": healthyFixture,
  };
  mockFetch(routesByUrl);
  renderPortal("/system");
  expect(await screen.findByText("Alles werkt")).toBeVisible();
  routesByUrl["/api/me"] = { ...platformAdminMeFixture, user: meFixture.user };
  emitAccessChanged(meFixture.user.id);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
  expect(screen.queryByText("Alles werkt")).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Beheer" })).toBeNull();
});

test("Log uit logs out and shows the login screen", async () => {
  const routesByUrl: Record<string, unknown> = {
    "/api/me": meFixture,
    "/api/auth/sign-out": { success: true },
  };
  mockFetch(routesByUrl);
  renderPortal("/");
  const button = await screen.findByRole("button", { name: "Log uit" });
  routesByUrl["/api/me"] = Response.json(
    { statusCode: 401, error: "Unauthorized", message: "x", code: "not_logged_in" },
    { status: 401 },
  );
  await userEvent.click(button);
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
  // The gate unmounted the layout, which closed the live stream.
  expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
});

test("after Log uit the next person starts at /, not on the page of the one before", async () => {
  const routesByUrl: Record<string, unknown> = {
    "/api/me": platformAdminMeFixture,
    "/api/species": { species: speciesFixture },
    "/api/auth/sign-out": { success: true },
    "/api/auth/email-otp/send-verification-otp": { success: true },
    "/api/auth/sign-in/email-otp": { user: { id: "u1", email: "noor@example.test" } },
  };
  mockFetch(routesByUrl);
  const { router } = renderPortal("/species");
  expect(await screen.findByRole("cell", { name: "Gewone pad" })).toBeVisible();
  routesByUrl["/api/me"] = Response.json(
    { statusCode: 401, error: "Unauthorized", message: "x", code: "not_logged_in" },
    { status: 401 },
  );
  await userEvent.click(screen.getByRole("button", { name: "Log uit" }));
  await screen.findByRole("heading", { name: "Log in bij PadVinder" });
  expect(router.state.location.pathname).toBe("/");

  // A volunteer logs in on the same device and sees the home page, not "Deze pagina bestaat niet".
  routesByUrl["/api/me"] = meFixture;
  await userEvent.type(screen.getByLabelText("E-mailadres"), "noor@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  await userEvent.type(await screen.findByLabelText("Code"), "123456");
  expect(
    await screen.findByText(
      "Het portaal is voor coördinatoren en beheerders. Tellen doe je in de app.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Deze pagina bestaat niet" })).toBeNull();
});

test("someone who opens a page before logging in lands on that page after it", async () => {
  const routesByUrl: Record<string, unknown> = {
    "/api/me": Response.json(
      { statusCode: 401, error: "Unauthorized", message: "x", code: "not_logged_in" },
      { status: 401 },
    ),
    "/api/health": healthyFixture,
    "/api/auth/email-otp/send-verification-otp": { success: true },
    "/api/auth/sign-in/email-otp": { user: { id: "u1", email: "noor@example.test" } },
  };
  mockFetch(routesByUrl);
  const { router } = renderPortal("/system");
  await userEvent.type(await screen.findByLabelText("E-mailadres"), "noor@example.test");
  routesByUrl["/api/me"] = platformAdminMeFixture;
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  await userEvent.type(await screen.findByLabelText("Code"), "123456");
  expect(await screen.findByRole("heading", { level: 1, name: "Systeemstatus" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/system");
});

test("Log uit that fails keeps the user logged in and says so", async () => {
  mockFetch({
    "/api/me": meFixture,
    "/api/auth/sign-out": new Response("boom", { status: 500 }),
  });
  renderPortal("/");
  await userEvent.click(await screen.findByRole("button", { name: "Log uit" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Uitloggen lukt nu niet. Controleer je verbinding en probeer het opnieuw.",
  );
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
  expect(screen.getByText(meFixture.user.name)).toBeVisible();
});

const reportBody = (message: string, includeContact: boolean) => ({
  message,
  includeContact,
  page: "/working-groups",
  appVersion: "dev",
  app: "portal",
});

test("Meld een probleem opens the form in a modal and thanks with a toast", async () => {
  const requests = recordRequests();
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/managed-working-groups": { workingGroups: withoutOpenRequests },
    "POST /api/problem-reports": new Response(null, { status: 204 }),
  });
  renderPortal("/working-groups");
  await userEvent.click(await screen.findByRole("button", { name: "Meld een probleem" }));
  const dialog = screen.getByRole("dialog", { name: "Meld een probleem" });
  // The modal has the title; the form has no second heading.
  expect(within(dialog).getAllByRole("heading")).toHaveLength(1);
  expect(within(dialog).getByText(coordinatorMeFixture.user.name)).toBeVisible();
  expect(within(dialog).getByText(coordinatorMeFixture.user.email)).toBeVisible();
  expect(within(dialog).getByRole("checkbox")).not.toBeChecked();
  await userEvent.type(within(dialog).getByLabelText("Wat ging er mis?"), "De tabel is leeg");
  await userEvent.click(within(dialog).getByRole("checkbox"));
  await userEvent.click(within(dialog).getByRole("button", { name: "Verstuur" }));
  expect(await screen.findByText("Bedankt, je melding is verstuurd.")).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(requestsTo(requests, "POST", "/api/problem-reports").map((r) => r.body)).toEqual([
    reportBody("De tabel is leeg", true),
  ]);

  // Opened again, the form starts empty and unticked.
  await userEvent.click(screen.getByRole("button", { name: "Meld een probleem" }));
  const again = screen.getByRole("dialog", { name: "Meld een probleem" });
  expect(within(again).getByLabelText("Wat ging er mis?")).toHaveValue("");
  expect(within(again).getByRole("checkbox")).not.toBeChecked();
});

test("a report that was not sent keeps the modal and the text, with the reason", async () => {
  mockFetch({
    "/api/me": meFixture,
    "POST /api/problem-reports": errorResponse(502, "report_not_sent"),
  });
  renderPortal("/");
  // A volunteer sees no navigation, but can report a problem.
  await userEvent.click(await screen.findByRole("button", { name: "Meld een probleem" }));
  const dialog = screen.getByRole("dialog", { name: "Meld een probleem" });
  await userEvent.type(within(dialog).getByLabelText("Wat ging er mis?"), "Leeg");
  await userEvent.click(within(dialog).getByRole("button", { name: "Verstuur" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Je melding is niet verstuurd. Probeer het zo nog eens.",
  );
  expect(within(dialog).getByLabelText("Wat ging er mis?")).toHaveValue("Leeg");

  // Closed and opened again, the old error is gone.
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "Meld een probleem" }));
  expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
});
