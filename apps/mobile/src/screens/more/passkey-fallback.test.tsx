import {
  applicantMeFixture,
  coordinatorMeFixture,
  detailsHiddenFixture,
  healthyFixture,
  membersFixture,
  membersWithContactFixture,
  platformAdminMeFixture,
  requestsForReviewFixture,
  workingGroupsFixture,
} from "@padvinder/contracts/fixtures";
import type { MeResponse } from "@padvinder/contracts";
import { createQueryClient } from "@padvinder/api-client";
import { mockFetch } from "@padvinder/api-client/testing";
import { startAuthentication } from "@simplewebauthn/browser";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { errorResponse, renderApp } from "../../testing/render-app";

vi.mock("../../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

const noord = workingGroupsFixture.find((g) => g.name === "Noord")!;
const zuid = workingGroupsFixture.find(
  (g) => g.organization.id === noord.organization.id && g.id !== noord.id,
)!;
const directory = { workingGroups: workingGroupsFixture };
const requestsPath = (id: string) => `/api/working-groups/${id}/membership-requests`;
const membersPath = (id: string) => `/api/working-groups/${id}/members`;
const [noor, sem] = requestsForReviewFixture;

const coordinatingAdmin: MeResponse = {
  ...applicantMeFixture,
  user: { ...applicantMeFixture.user, hasPasskey: true },
  memberships: [
    { id: "0192f3c0-0000-7000-8000-0000000000c1", isCoordinator: true, workingGroup: noord },
  ],
  organizationAdminOf: [noord.organization],
  adminConfirmedUntil: null,
};
const confirmedUntil = () => new Date(Date.now() + 3_600_000).toISOString();

beforeEach(() => {
  vi.mocked(startAuthentication).mockResolvedValue({ id: "x" } as never);
});

test("an unconfirmed admin who coordinates Noord sees Noord's requests without a modal, and Zuid as a name with the bar", async () => {
  const { calls } = mockFetch({
    "/api/me": coordinatingAdmin,
    "/api/working-groups": directory,
    [requestsPath(noord.id)]: { membershipRequests: [noor] },
  });
  renderApp("/app/more/membership-requests");
  expect(await screen.findByRole("button", { name: /Noor Jansen/ })).toBeVisible();
  expect(screen.getByText(zuid.name)).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Toon met je toegangssleutel" }).length).toBe(
    workingGroupsFixture.filter((g) => g.organization.id === noord.organization.id).length - 1,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(calls).not.toContain(requestsPath(zuid.id));
});

test("the eye confirms and Zuid's requests show", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": coordinatingAdmin,
    "/api/working-groups": directory,
    [requestsPath(noord.id)]: { membershipRequests: [noor] },
    ...Object.fromEntries(
      workingGroupsFixture
        .filter((g) => g.organization.id === noord.organization.id && g.id !== noord.id)
        .map((g) => [requestsPath(g.id), { membershipRequests: g.id === zuid.id ? [sem] : [] }]),
    ),
    "POST /api/auth/passkey/generate-authenticate-options": { challenge: "c" },
    "POST /api/auth/passkey/verify-authentication": { ok: true },
  };
  mockFetch(routes);
  vi.mocked(startAuthentication).mockImplementation(async () => {
    routes["/api/me"] = { ...coordinatingAdmin, adminConfirmedUntil: confirmedUntil() };
    return { id: "x" } as never;
  });
  renderApp("/app/more/membership-requests");
  const eyes = await screen.findAllByRole("button", { name: "Toon met je toegangssleutel" });
  await userEvent.click(eyes[0]!);
  const modal = await screen.findByRole("dialog", { name: "Bevestig dat jij het bent" });
  await userEvent.click(within(modal).getByRole("button", { name: "Gebruik je toegangssleutel" }));
  expect(await screen.findByRole("button", { name: /Sem de Vries/ })).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("button", { name: "Toon met je toegangssleutel" })).toBeNull();
});

test("the members screen of a volunteer-admin opens a member, whose detail shows the bars", async () => {
  const [anna, bram] = membersFixture;
  const volunteerAdmin: MeResponse = {
    ...coordinatingAdmin,
    memberships: [{ ...coordinatingAdmin.memberships[0]!, isCoordinator: false }],
  };
  mockFetch({
    "/api/me": volunteerAdmin,
    "/api/working-groups": directory,
    [membersPath(noord.id)]: {
      members: [anna, bram],
      passkeyReveals: ["email", "phone", "hasLoggedIn"],
    },
  });
  renderApp("/app/more/members");
  await userEvent.click(await screen.findByRole("button", { name: /Bram Jansen/ }));
  expect(await screen.findByRole("heading", { name: "Bram Jansen" })).toBeVisible();
  // One bar for the address and one for the phone number.
  expect(screen.getAllByRole("button", { name: "Toon met je toegangssleutel" })).toHaveLength(2);
  expect(screen.queryByRole("link", { name: /@example\.test/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Verwijder/ })).toBeNull();
});

test("a request of an administered group opened by its address shows the modal, then the request", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": coordinatingAdmin,
    "/api/working-groups": directory,
    "POST /api/auth/passkey/generate-authenticate-options": { challenge: "c" },
    "POST /api/auth/passkey/verify-authentication": { ok: true },
  };
  mockFetch(routes);
  let confirmed = false;
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === `/api/membership-requests/${noor!.id}`) {
      return confirmed ? Response.json(noor) : errorResponse(403, "passkey_required");
    }
    return inner(request);
  };
  vi.mocked(startAuthentication).mockImplementation(async () => {
    confirmed = true;
    routes["/api/me"] = { ...coordinatingAdmin, adminConfirmedUntil: confirmedUntil() };
    return { id: "x" } as never;
  });
  try {
    renderApp(`/app/more/membership-requests/${noor!.id}`, createQueryClient());
    const modal = await screen.findByRole("dialog", { name: "Bevestig dat jij het bent" });
    await userEvent.click(
      within(modal).getByRole("button", { name: "Gebruik je toegangssleutel" }),
    );
    expect(await screen.findByRole("heading", { name: "Noor Jansen" })).toBeVisible();
  } finally {
    globalThis.fetch = inner;
  }
});

test("the system screen shows the bar for an unconfirmed platform admin", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "/api/health": { ...detailsHiddenFixture, passkeyReveals: ["database"] },
  });
  renderApp("/app/more/system");
  expect(await screen.findByRole("button", { name: "Toon met je toegangssleutel" })).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a volunteer and a coordinator without an admin role see no bar and no modal anywhere", async () => {
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/working-groups": directory,
    [requestsPath(noord.id)]: { membershipRequests: [noor] },
    [membersPath(noord.id)]: { members: membersWithContactFixture },
    "/api/health": healthyFixture,
  });
  const { unmount } = renderApp("/app/more/membership-requests");
  expect(await screen.findByRole("button", { name: /Noor Jansen/ })).toBeVisible();
  unmount();
  renderApp("/app/more/members");
  expect(await screen.findByRole("button", { name: /Bram Jansen/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Toon met je toegangssleutel" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("an unconfirmed organization admin without memberships sees every group as a name with the bar", async () => {
  const admin: MeResponse = { ...coordinatingAdmin, memberships: [] };
  const own = workingGroupsFixture.filter((g) => g.organization.id === noord.organization.id);
  for (const path of ["/app/more/membership-requests", "/app/more/members"]) {
    mockFetch({ "/api/me": admin, "/api/working-groups": directory });
    const { unmount } = renderApp(path);
    for (const group of own) expect(await screen.findByText(group.name)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Toon met je toegangssleutel" })).toHaveLength(
      own.length,
    );
    expect(screen.queryByText("Dit mag je niet doen.")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
  }
});
