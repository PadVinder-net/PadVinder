import { FakeEventSource, mockFetch } from "@padvinder/api-client/testing";
import {
  applicantMeFixture,
  coordinatorMeFixture,
  managedWorkingGroupsFixture,
  meFixture,
  platformAdminMeFixture,
  reviewableRequestsFixture,
} from "@padvinder/contracts/fixtures";
import type { MembershipRequestForReview, MeResponse } from "@padvinder/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";
import { errorResponse, holdRequests, recordRequests, requestsTo } from "../testing/requests";

const [lotte, daan, mila] = reviewableRequestsFixture as [
  MembershipRequestForReview,
  MembershipRequestForReview,
  MembershipRequestForReview,
];

/** An admin of Paddentrek Voorbeeldstad, without a membership. */
const adminMe: MeResponse = {
  ...applicantMeFixture,
  organizationAdminOf: [lotte.workingGroup.organization],
};

/** A request of a group in another organization. */
const otherOrganizationRequest: MembershipRequestForReview = {
  ...mila,
  id: "0192f3c0-0000-7000-8000-0000000000e4",
  workingGroup: {
    id: "0192f3c0-0000-7000-8000-0000000000b3",
    name: "Dorp",
    city: "Fictiefdorp",
    organization: {
      id: "0192f3c0-0000-7000-8000-0000000000a2",
      name: "Paddenwerkgroep Fictiefdorp",
    },
  },
  applicant: {
    id: "0192f3c0-0000-7000-8000-000000000008",
    name: "Bas Mulder",
    email: "bas@example.test",
    phone: null,
  },
};

const pagePath = "/membership-requests";
const listPath = "/api/membership-requests";

function routesFor(
  me: MeResponse,
  requests: MembershipRequestForReview[] = reviewableRequestsFixture,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    "/api/me": me,
    "GET /api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
    [`GET ${listPath}`]: { membershipRequests: requests },
    ...extra,
  };
}

/** What the server sends when a request of a working group changed. */
function emitRequestsChanged(request: MembershipRequestForReview) {
  act(() => {
    for (const source of FakeEventSource.instances)
      source.emit(
        "membership-requests-changed",
        JSON.stringify({
          type: "membership-requests-changed",
          workingGroupId: request.workingGroup.id,
          organizationId: request.workingGroup.organization.id,
        }),
      );
  });
}

const decided = (request: MembershipRequestForReview, status: "approved" | "rejected") => ({
  ...request,
  status,
  decidedAt: "2027-01-12T09:30:00.000+01:00",
});

async function openRequest(name: string) {
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog", { name });
}

const searchOf = (router: ReturnType<typeof renderPortal>["router"]) =>
  router.state.location.search;

test("shows the open requests per working group", async () => {
  mockFetch(routesFor(adminMe));
  renderPortal(pagePath);
  expect(await screen.findByRole("heading", { level: 1, name: "Aanmeldingen" })).toBeVisible();
  const noord = await screen.findByRole("heading", { level: 2, name: "Noord" });
  expect(noord).toBeVisible();
  expect(screen.getByRole("heading", { level: 2, name: "Zuid-Oost" })).toBeVisible();
  const [first, second] = screen.getAllByRole("table") as [HTMLElement, HTMLElement];
  expect(
    within(first)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Lotte Visser", "Daan Smit"]);
  expect(within(first).getByText("8 januari 2027")).toBeVisible();
  expect(
    within(second)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Mila Peters"]);
});

test("while the list loads the page says so, and a failed load offers Probeer opnieuw", async () => {
  const routes = routesFor(adminMe, reviewableRequestsFixture, {
    [`GET ${listPath}`]: new Response("boom", { status: 500 }),
  });
  mockFetch(routes);
  renderPortal(pagePath);
  expect(await screen.findByText("Aanmeldingen laden…")).toBeVisible();
  expect(
    await screen.findByText("Het lukt nu niet. Controleer je verbinding en probeer het opnieuw."),
  ).toBeVisible();
  routes[`GET ${listPath}`] = { membershipRequests: reviewableRequestsFixture };
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(await screen.findByRole("button", { name: "Lotte Visser" })).toBeVisible();
});

test("requests of two organizations show the organization next to each working group; requests of one do not", async () => {
  const routes = routesFor(platformAdminMeFixture, [
    ...reviewableRequestsFixture,
    otherOrganizationRequest,
  ]);
  mockFetch(routes);
  renderPortal(pagePath);
  expect(
    await screen.findByRole("heading", { level: 2, name: "Noord (Paddentrek Voorbeeldstad)" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { level: 2, name: "Dorp (Paddenwerkgroep Fictiefdorp)" }),
  ).toBeVisible();

  routes[`GET ${listPath}`] = { membershipRequests: reviewableRequestsFixture };
  emitRequestsChanged(otherOrganizationRequest);
  expect(await screen.findByRole("heading", { level: 2, name: "Noord" })).toBeVisible();
  expect(screen.queryByText(/Paddentrek Voorbeeldstad/)).toBeNull();
});

test("choosing a row opens the modal and puts the request in the address", async () => {
  mockFetch(routesFor(adminMe));
  const { router } = renderPortal(pagePath);
  const dialog = await openRequest("Lotte Visser");
  expect(searchOf(router)).toBe(`?request=${lotte.id}`);
  expect(within(dialog).getByText(lotte.applicant.email!)).toBeVisible();
  expect(within(dialog).getByText(lotte.applicant.phone!)).toBeVisible();
  expect(within(dialog).getByText("Noord")).toBeVisible();
  expect(within(dialog).getByText("Aangemeld op 8 januari 2027")).toBeVisible();
  // The title holds the name; the detail shows no second heading.
  expect(
    within(dialog)
      .getAllByRole("heading")
      .map((heading) => heading.textContent),
  ).toEqual(["Lotte Visser"]);
  // Back closes the modal again.
  await act(() => router.navigate(-1));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("opening the address with ?request opens the same modal, and only GET requests were made", async () => {
  const requests = recordRequests();
  mockFetch(routesFor(adminMe));
  renderPortal(`${pagePath}?request=${daan.id}`);
  const dialog = await screen.findByRole("dialog", { name: "Daan Smit" });
  expect(within(dialog).getByText(daan.applicant.email!)).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Keur goed" })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
  // The list held it, so the request itself was not asked for.
  expect(requestsTo(requests, "GET", `${listPath}/`)).toEqual([]);
});

test("the modal has Keur goed and Wijs af and no Annuleer", async () => {
  mockFetch(routesFor(adminMe));
  renderPortal(pagePath);
  const dialog = await openRequest("Lotte Visser");
  expect(
    within(dialog)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Sluiten", "Keur goed", "Wijs af"]);
  expect(within(dialog).queryByRole("button", { name: "Annuleer" })).toBeNull();
});

test.each([
  ["the cross", () => userEvent.click(screen.getByRole("button", { name: "Sluiten" }))],
  ["Escape", () => userEvent.keyboard("{Escape}")],
  [
    "a click beside it",
    () => userEvent.click(document.querySelector<HTMLElement>("[data-slot=dialog-overlay]")!),
  ],
])(
  "the cross, Escape and a click beside it close the modal, clear the address and decide nothing (%s)",
  async (_how, close) => {
    const requests = recordRequests();
    mockFetch(routesFor(adminMe));
    const { router } = renderPortal(pagePath);
    await openRequest("Lotte Visser");
    await close();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(searchOf(router)).toBe("");
    expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(screen.queryByText(/is toegelaten|is afgewezen|al behandeld/)).toBeNull();
    // It opens again.
    expect(await openRequest("Lotte Visser")).toBeVisible();
  },
);

test("Keur goed approves, closes, clears the address and shows the toast with name and working group", async () => {
  const requests = recordRequests();
  const routes = routesFor(adminMe, reviewableRequestsFixture, {
    [`POST ${listPath}/${lotte.id}/approve`]: decided(lotte, "approved"),
  });
  mockFetch(routes);
  const release = holdRequests((request) => request.method === "POST");
  const { router } = renderPortal(pagePath);
  const dialog = await openRequest("Lotte Visser");
  await userEvent.click(within(dialog).getByRole("button", { name: "Keur goed" }));
  // While the decision runs, the modal cannot be closed.
  await waitFor(() =>
    expect(within(dialog).getAllByRole("button", { name: "Even geduld…" })).toHaveLength(2),
  );
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Lotte Visser" })).toBeVisible();
  routes[`GET ${listPath}`] = { membershipRequests: [daan, mila] };
  release();
  expect(await screen.findByText("Lotte Visser is toegelaten tot Noord.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(searchOf(router)).toBe("");
  expect(requestsTo(requests, "POST", listPath)).toEqual([
    { method: "POST", path: `${listPath}/${lotte.id}/approve`, body: undefined },
  ]);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Lotte Visser" })).toBeNull());
  // Our own decision is not reported as decided by someone else.
  expect(screen.queryByText("Deze aanmelding is al behandeld.")).toBeNull();
});

test("the live event of our own decision, before its answer, keeps the modal and shows only the decision's toast", async () => {
  const routes = routesFor(adminMe, reviewableRequestsFixture, {
    [`POST ${listPath}/${lotte.id}/approve`]: decided(lotte, "approved"),
  });
  mockFetch(routes);
  const release = holdRequests((request) => request.method === "POST");
  renderPortal(pagePath);
  const dialog = await openRequest("Lotte Visser");
  await userEvent.click(within(dialog).getByRole("button", { name: "Keur goed" }));
  routes[`GET ${listPath}`] = { membershipRequests: [daan, mila] };
  emitRequestsChanged(lotte);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Lotte Visser", hidden: true })).toBeNull(),
  );
  expect(screen.getByRole("dialog", { name: "Lotte Visser" })).toBeVisible();
  release();
  expect(await screen.findByText("Lotte Visser is toegelaten tot Noord.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByText("Deze aanmelding is al behandeld.")).toBeNull();
});

test("Wijs af rejects at once and shows its toast", async () => {
  const requests = recordRequests();
  const routes = routesFor(adminMe, reviewableRequestsFixture, {
    [`POST ${listPath}/${daan.id}/reject`]: decided(daan, "rejected"),
  });
  mockFetch(routes);
  const { router } = renderPortal(pagePath);
  const dialog = await openRequest("Daan Smit");
  routes[`GET ${listPath}`] = { membershipRequests: [lotte, mila] };
  await userEvent.click(within(dialog).getByRole("button", { name: "Wijs af" }));
  // No question first.
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(await screen.findByText("De aanmelding van Daan Smit is afgewezen.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(searchOf(router)).toBe("");
  expect(requestsTo(requests, "POST", listPath)).toEqual([
    { method: "POST", path: `${listPath}/${daan.id}/reject`, body: undefined },
  ]);
  expect(screen.queryByText("Deze aanmelding is al behandeld.")).toBeNull();
});

test("the toasts of a person without a name say Deze persoon and deze persoon", async () => {
  const nameless = { ...lotte, applicant: { ...lotte.applicant, name: "" } };
  const routes = routesFor(adminMe, [nameless, daan], {
    [`POST ${listPath}/${nameless.id}/approve`]: decided(nameless, "approved"),
    [`POST ${listPath}/${daan.id}/reject`]: decided(daan, "rejected"),
  });
  mockFetch(routes);
  renderPortal(pagePath);
  let dialog = await openRequest("(nog geen naam)");
  const namelessDaan = { ...daan, applicant: { ...daan.applicant, name: "" } };
  routes[`GET ${listPath}`] = { membershipRequests: [namelessDaan] };
  await userEvent.click(within(dialog).getByRole("button", { name: "Keur goed" }));
  expect(await screen.findByText("Deze persoon is toegelaten tot Noord.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Daan Smit" })).toBeNull());

  dialog = await openRequest("(nog geen naam)");
  await userEvent.click(within(dialog).getByRole("button", { name: "Wijs af" }));
  expect(await screen.findByText("De aanmelding van deze persoon is afgewezen.")).toBeVisible();
});

test("a request that was decided in the meantime shows no modal and the toast Deze aanmelding is al behandeld.", async () => {
  const requests = recordRequests();
  mockFetch(
    routesFor(adminMe, [daan, mila], {
      [`GET ${listPath}/${lotte.id}`]: decided(lotte, "approved"),
    }),
  );
  const { router } = renderPortal(`${pagePath}?request=${lotte.id}`);
  expect(await screen.findByText("Deze aanmelding is al behandeld.")).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(searchOf(router)).toBe(""));
  expect(requestsTo(requests, "GET", `${listPath}/${lotte.id}`)).toHaveLength(1);
  expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
});

test.each([
  [403, "not_allowed"],
  [404, "not_found"],
])(
  "an id the user may not see shows no modal and the toast Deze aanmelding bestaat niet meer. (%i)",
  async (status, code) => {
    const requests = recordRequests();
    mockFetch(
      routesFor(adminMe, reviewableRequestsFixture, {
        [`GET ${listPath}/${otherOrganizationRequest.id}`]: errorResponse(status, code),
      }),
    );
    const { router } = renderPortal(`${pagePath}?request=${otherOrganizationRequest.id}`);
    expect(await screen.findByText("Deze aanmelding bestaat niet meer.")).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(searchOf(router)).toBe(""));
    expect(requestsTo(requests, "GET", `${listPath}/${otherOrganizationRequest.id}`)).toHaveLength(
      1,
    );
  },
);

test("a request in the address that cannot be asked for says so, opens nothing and keeps the address", async () => {
  const requests = recordRequests();
  mockFetch(
    routesFor(adminMe, reviewableRequestsFixture, {
      [`GET ${listPath}/${otherOrganizationRequest.id}`]: new Response("boom", { status: 502 }),
    }),
  );
  const { router } = renderPortal(`${pagePath}?request=${otherOrganizationRequest.id}`);
  expect(
    await screen.findByText("Het lukt nu niet. Controleer je verbinding en probeer het opnieuw."),
  ).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(searchOf(router)).toBe(`?request=${otherOrganizationRequest.id}`);
  expect(requestsTo(requests, "GET", `${listPath}/${otherOrganizationRequest.id}`)).toHaveLength(1);
});

test("a late answer for a request in the address does not close the request chosen since", async () => {
  const requests = recordRequests();
  mockFetch(
    routesFor(adminMe, reviewableRequestsFixture, {
      [`GET ${listPath}/${otherOrganizationRequest.id}`]: decided(
        otherOrganizationRequest,
        "approved",
      ),
    }),
  );
  const release = holdRequests((request) =>
    request.url.endsWith(`${listPath}/${otherOrganizationRequest.id}`),
  );
  const { router } = renderPortal(`${pagePath}?request=${otherOrganizationRequest.id}`);
  await openRequest("Lotte Visser");
  expect(searchOf(router)).toBe(`?request=${lotte.id}`);
  release();
  await waitFor(() =>
    expect(requestsTo(requests, "GET", `${listPath}/${otherOrganizationRequest.id}`)).toHaveLength(
      1,
    ),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(screen.getByRole("dialog", { name: "Lotte Visser" })).toBeVisible();
  expect(searchOf(router)).toBe(`?request=${lotte.id}`);
  expect(screen.queryByText("Deze aanmelding is al behandeld.")).toBeNull();
});

test("a late answer after the user left the page keeps them where they went, without a toast", async () => {
  const requests = recordRequests();
  mockFetch(
    routesFor(adminMe, reviewableRequestsFixture, {
      [`GET ${listPath}/${otherOrganizationRequest.id}`]: decided(
        otherOrganizationRequest,
        "approved",
      ),
    }),
  );
  const release = holdRequests((request) =>
    request.url.endsWith(`${listPath}/${otherOrganizationRequest.id}`),
  );
  const { router } = renderPortal(`${pagePath}?request=${otherOrganizationRequest.id}`);
  await screen.findByRole("button", { name: "Lotte Visser" });
  await userEvent.click(screen.getByRole("link", { name: "Werkgroepen" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Werkgroepen" })).toBeVisible();
  release();
  await waitFor(() =>
    expect(requestsTo(requests, "GET", `${listPath}/${otherOrganizationRequest.id}`)).toHaveLength(
      1,
    ),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(router.state.location.pathname).toBe("/working-groups");
  expect(router.state.location.search).toBe("");
  expect(screen.getByRole("heading", { level: 1, name: "Werkgroepen" })).toBeVisible();
  expect(screen.queryByText(/al behandeld|bestaat niet meer/)).toBeNull();
});

test("a decision that ends after the user left still shows its toast, and leaves the address alone", async () => {
  mockFetch(
    routesFor(adminMe, reviewableRequestsFixture, {
      [`POST ${listPath}/${lotte.id}/approve`]: decided(lotte, "approved"),
    }),
  );
  const release = holdRequests((request) => request.method === "POST");
  const { router } = renderPortal(pagePath);
  const dialog = await openRequest("Lotte Visser");
  await userEvent.click(within(dialog).getByRole("button", { name: "Keur goed" }));
  await waitFor(() =>
    expect(within(dialog).getAllByRole("button", { name: "Even geduld…" })).toHaveLength(2),
  );
  await act(() => router.navigate("/working-groups"));
  expect(await screen.findByRole("heading", { level: 1, name: "Werkgroepen" })).toBeVisible();
  release();
  expect(await screen.findByText("Lotte Visser is toegelaten tot Noord.")).toBeVisible();
  expect(router.state.location.pathname).toBe("/working-groups");
  expect(screen.queryByText("Deze aanmelding is al behandeld.")).toBeNull();
});

test("a request that is newer than the list refetches the list and then opens its modal", async () => {
  const newer = { ...otherOrganizationRequest, workingGroup: lotte.workingGroup };
  const requests = recordRequests();
  const routes = routesFor(adminMe, reviewableRequestsFixture, {
    [`GET ${listPath}/${newer.id}`]: newer,
  });
  mockFetch(routes);
  // The first list is older than the request; the list after the request holds it.
  holdRequests((request) => {
    if (new URL(request.url).pathname === `${listPath}/${newer.id}`)
      routes[`GET ${listPath}`] = { membershipRequests: [...reviewableRequestsFixture, newer] };
    return false;
  });
  const { router } = renderPortal(`${pagePath}?request=${newer.id}`);
  expect(await screen.findByRole("dialog", { name: "Bas Mulder" })).toBeVisible();
  expect(screen.queryByText(/al behandeld|bestaat niet meer/)).toBeNull();
  expect(searchOf(router)).toBe(`?request=${newer.id}`);
  expect(requestsTo(requests, "GET", `${listPath}/${newer.id}`)).toHaveLength(1);
  expect(requestsTo(requests, "GET", listPath).filter((r) => r.path === listPath)).toHaveLength(2);
});

test("a decision that answers already_decided closes the modal with the toast", async () => {
  const routes = routesFor(adminMe, reviewableRequestsFixture, {
    [`POST ${listPath}/${lotte.id}/reject`]: errorResponse(409, "already_decided"),
  });
  mockFetch(routes);
  const { router } = renderPortal(pagePath);
  const dialog = await openRequest("Lotte Visser");
  routes[`GET ${listPath}`] = { membershipRequests: [daan, mila] };
  await userEvent.click(within(dialog).getByRole("button", { name: "Wijs af" }));
  expect(await screen.findByText("Deze aanmelding is al behandeld.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(searchOf(router)).toBe("");
  expect(screen.queryByText(/is afgewezen/)).toBeNull();
  // One toast, not a second one when the refetched list lacks the request.
  expect(screen.getAllByText("Deze aanmelding is al behandeld.")).toHaveLength(1);
});

test("another failed decision keeps the modal open with the error", async () => {
  mockFetch(
    routesFor(adminMe, reviewableRequestsFixture, {
      [`POST ${listPath}/${lotte.id}/approve`]: new Response("boom", { status: 500 }),
    }),
  );
  const { router } = renderPortal(pagePath);
  const dialog = await openRequest("Lotte Visser");
  await userEvent.click(within(dialog).getByRole("button", { name: "Keur goed" }));
  expect(
    await within(dialog).findByText(
      "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("dialog", { name: "Lotte Visser" })).toBeVisible();
  expect(searchOf(router)).toBe(`?request=${lotte.id}`);
  // The error belongs to that request; another one opens without it.
  await userEvent.keyboard("{Escape}");
  const other = await openRequest("Daan Smit");
  expect(within(other).queryByText(/Het lukt nu niet/)).toBeNull();
});

test("a membership-requests-changed event takes a decided request out of the list", async () => {
  const routes = routesFor(adminMe);
  mockFetch(routes);
  renderPortal(pagePath);
  expect(await screen.findByRole("button", { name: "Daan Smit" })).toBeVisible();
  routes[`GET ${listPath}`] = { membershipRequests: [lotte, mila] };
  emitRequestsChanged(daan);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Daan Smit" })).toBeNull());
  expect(screen.getByRole("button", { name: "Lotte Visser" })).toBeVisible();
  expect(screen.queryByText("Deze aanmelding is al behandeld.")).toBeNull();
});

test("a membership-requests-changed event while a modal is open keeps the modal of a request that is still open, and closes the modal of a request that is gone with the toast Deze aanmelding is al behandeld.", async () => {
  const requests = recordRequests();
  const routes = routesFor(adminMe);
  mockFetch(routes);
  const { router } = renderPortal(pagePath);
  await openRequest("Lotte Visser");

  // A colleague decides another request: the list follows, the modal stays.
  routes[`GET ${listPath}`] = { membershipRequests: [lotte, mila] };
  emitRequestsChanged(daan);
  await waitFor(() =>
    expect(requestsTo(requests, "GET", listPath).filter((r) => r.path === listPath)).toHaveLength(
      2,
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Daan Smit", hidden: true })).toBeNull(),
  );
  expect(screen.getByRole("dialog", { name: "Lotte Visser" })).toBeVisible();
  expect(screen.queryByText("Deze aanmelding is al behandeld.")).toBeNull();

  // A colleague decides this one: the modal closes with the toast.
  routes[`GET ${listPath}`] = { membershipRequests: [mila] };
  emitRequestsChanged(lotte);
  expect(await screen.findByText("Deze aanmelding is al behandeld.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(searchOf(router)).toBe("");
  expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
  // It did not ask for the request: the modal had it, so it is gone.
  expect(requestsTo(requests, "GET", `${listPath}/`)).toEqual([]);
});

test("a coordinator sees the requests of their group", async () => {
  mockFetch(routesFor(coordinatorMeFixture, [lotte, daan]));
  renderPortal(pagePath);
  expect(await screen.findByRole("button", { name: "Lotte Visser" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Daan Smit" })).toBeVisible();
});

test("a volunteer who opens /membership-requests sees the not-found page", async () => {
  const requests = recordRequests();
  mockFetch(routesFor(meFixture));
  renderPortal(`${pagePath}?request=${lotte.id}`);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(requestsTo(requests, "GET", listPath)).toEqual([]);
});
