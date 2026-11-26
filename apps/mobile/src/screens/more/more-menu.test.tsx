import {
  applicantMeFixture,
  coordinatorMeFixture,
  healthyFixture,
  meFixture,
  platformAdminMeFixture,
  requestsForReviewFixture,
  workingGroupsFixture,
} from "@padvinder/contracts/fixtures";
import type { MeResponse } from "@padvinder/contracts";
import { listMembershipRequestsQueryKey } from "@padvinder/api-client";
import { mockFetch } from "@padvinder/api-client/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderApp } from "../../testing/render-app";

vi.mock("../../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

const directory = { workingGroups: workingGroupsFixture };
const group = (name: string) => workingGroupsFixture.find((g) => g.name === name)!;
const noord = group("Noord");
const requestsOf = (id: string) => `/api/working-groups/${id}/membership-requests`;
const noordRequests = {
  membershipRequests: requestsForReviewFixture.filter((r) => r.workingGroup.id === noord.id),
};
const none = { membershipRequests: [] };

const menu = () => screen.findByRole("navigation", { name: "Meer" });
const menuLinks = async () =>
  within(await menu())
    .getAllByRole("link")
    .map((link) => link.textContent);

test("a volunteer's menu has Profiel, Leden and Log uit", async () => {
  const { calls } = mockFetch({ "/api/me": meFixture, "/api/working-groups": directory });
  renderApp("/app/more");
  await waitFor(async () =>
    expect(await menuLinks()).toEqual(["Profiel", "Leden", "Meld een probleem"]),
  );
  expect(screen.getByRole("link", { name: "Profiel" })).toHaveAttribute(
    "href",
    "/app/more/profile",
  );
  expect(screen.getByRole("link", { name: "Leden" })).toHaveAttribute("href", "/app/more/members");
  expect(screen.getByRole("link", { name: "Meld een probleem" })).toHaveAttribute(
    "href",
    "/app/more/report-problem",
  );
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
  expect(calls.some((path) => path.endsWith("/membership-requests"))).toBe(false);
  expect(calls).not.toContain("/api/health");
});

test("a coordinator's menu shows Aanmeldingen with the count", async () => {
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/working-groups": directory,
    [requestsOf(noord.id)]: noordRequests,
  });
  renderApp("/app/more");
  const link = await screen.findByRole("link", { name: /Aanmeldingen/ });
  expect(link).toHaveAttribute("href", "/app/more/membership-requests");
  expect(await within(link).findByText("2")).toBeVisible();
  expect(link).toHaveAccessibleName("Aanmeldingen, 2 open");
  expect(await menuLinks()).toEqual(["Profiel", "Aanmeldingen2", "Leden", "Meld een probleem"]);
});

test("the count is left out when there are no open requests", async () => {
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/working-groups": directory,
    [requestsOf(noord.id)]: none,
  });
  const { client } = renderApp("/app/more");
  const link = await screen.findByRole("link", { name: "Aanmeldingen" });
  const key = listMembershipRequestsQueryKey({ path: { workingGroupId: noord.id } });
  await waitFor(() => expect(client.getQueryState(key)?.status).toBe("success"));
  expect(link.textContent).toBe("Aanmeldingen");
});

test("an organization admin without a membership sees Aanmeldingen and Leden for the organization's groups", async () => {
  const admin: MeResponse = { ...applicantMeFixture, organizationAdminOf: [noord.organization] };
  const { calls } = mockFetch({
    "/api/me": admin,
    "/api/working-groups": directory,
    [requestsOf(noord.id)]: noordRequests,
    [requestsOf(group("Salamanderbrug").id)]: none,
    [requestsOf(group("Zuid-Oost").id)]: {
      membershipRequests: requestsForReviewFixture.filter(
        (r) => r.workingGroup.id === group("Zuid-Oost").id,
      ),
    },
  });
  renderApp("/app/more");
  const link = await screen.findByRole("link", { name: /Aanmeldingen/ });
  expect(await within(link).findByText("3")).toBeVisible();
  expect(await menuLinks()).toEqual(["Profiel", "Aanmeldingen3", "Leden", "Meld een probleem"]);
  // Groups of another organization are not asked for.
  expect(calls).not.toContain(requestsOf(group("Dorp").id));
});

test("a platform admin's menu shows Systeemstatus", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture, "/api/working-groups": directory });
  renderApp("/app/more");
  await waitFor(async () =>
    expect(await menuLinks()).toEqual(["Profiel", "Systeemstatus", "Meld een probleem"]),
  );
  expect(screen.getByRole("link", { name: "Systeemstatus" })).toHaveAttribute(
    "href",
    "/app/more/system",
  );
});

test("the system status screen shows the status to a platform admin", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture, "/api/health": healthyFixture });
  renderApp("/app/more/system");
  expect(await screen.findByRole("heading", { name: "Systeemstatus" })).toBeVisible();
  expect(await screen.findByText("Alles werkt")).toBeVisible();
});

test("the system status screen opened by someone else says no, and fetches nothing", async () => {
  const { calls } = mockFetch({ "/api/me": meFixture, "/api/health": healthyFixture });
  renderApp("/app/more/system");
  expect(await screen.findByText("Dit mag je niet doen.")).toBeVisible();
  expect(calls).not.toContain("/api/health");
});

test("the system status screen shows the load error", async () => {
  mockFetch({
    "/api/me": platformAdminMeFixture,
    "/api/health": new Response("boom", { status: 500 }),
  });
  renderApp("/app/more/system");
  expect(await screen.findByText(/De server is niet bereikbaar/)).toBeVisible();
});
