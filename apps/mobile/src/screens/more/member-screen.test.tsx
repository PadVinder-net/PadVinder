import {
  applicantMeFixture,
  coordinatorMeFixture,
  meFixture,
  platformAdminMeFixture,
  membersFixture,
  membersWithContactFixture,
  workingGroupsFixture,
} from "@padvinder/contracts/fixtures";
import type { MeResponse } from "@padvinder/contracts";
import { mockFetch } from "@padvinder/api-client/testing";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { errorResponse, renderApp } from "../../testing/render-app";

vi.mock("../../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

const noord = workingGroupsFixture.find((g) => g.name === "Noord")!;
const directory = { workingGroups: workingGroupsFixture };
const membersPath = `/api/working-groups/${noord.id}/members`;
const [anna, bram, cigdem] = membersWithContactFixture;

test("a volunteer sees the names and roles, and cannot open a member", async () => {
  mockFetch({
    "/api/me": meFixture,
    "/api/working-groups": directory,
    [membersPath]: { members: membersFixture },
  });
  renderApp("/app/more/members");
  expect(await screen.findByText("Bram Jansen")).toBeVisible();
  expect(screen.getByText("coördinator")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Bram Jansen/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Terug" })).toHaveAttribute("href", "/app/more");
});

test("removing a member asks first, then returns to the list with the message", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": coordinatorMeFixture,
    "/api/working-groups": directory,
    [membersPath]: { members: membersWithContactFixture },
    [`DELETE /api/memberships/${bram!.membershipId}`]: new Response(null, { status: 204 }),
  };
  mockFetch(routes);
  const { router } = renderApp("/app/more/members");
  await userEvent.click(await screen.findByRole("button", { name: /Bram Jansen/ }));
  expect(router.state.location.pathname).toBe(`/app/more/members/${bram!.membershipId}`);
  expect(await screen.findByRole("link", { name: "bram@example.test" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Verwijder uit werkgroep" }));
  const dialog = await screen.findByRole("alertdialog", {
    name: "Bram Jansen verwijderen uit Noord?",
  });
  routes[membersPath] = { members: [anna, cigdem] };
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder" }));
  expect(await screen.findByText("Bram Jansen is verwijderd uit Noord.")).toBeVisible();
  expect(router.state.location.pathname).toBe("/app/more/members");
  expect(await screen.findByRole("button", { name: /Anna de Vries/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Bram Jansen/ })).toBeNull();
});

test("a coordinator cannot remove another coordinator", async () => {
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/working-groups": directory,
    [membersPath]: { members: membersWithContactFixture },
  });
  renderApp(`/app/more/members/${anna!.membershipId}`);
  expect(await screen.findByRole("heading", { name: "Anna de Vries" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Verwijder uit werkgroep" })).toBeNull();
  expect(screen.getByRole("link", { name: "Terug" })).toHaveAttribute("href", "/app/more/members");
});

test("a refused removal shows the API's text inside the dialog", async () => {
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/working-groups": directory,
    [membersPath]: { members: membersWithContactFixture },
    [`DELETE /api/memberships/${bram!.membershipId}`]: errorResponse(403, "not_allowed"),
  });
  renderApp(`/app/more/members/${bram!.membershipId}`);
  await userEvent.click(await screen.findByRole("button", { name: "Verwijder uit werkgroep" }));
  const dialog = await screen.findByRole("alertdialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder" }));
  expect(await within(dialog).findByText("Dit mag je niet doen.")).toBeVisible();
});

test("a member who is not in any list shows the not-found text", async () => {
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/working-groups": directory,
    [membersPath]: { members: membersWithContactFixture },
  });
  renderApp("/app/more/members/0192f3c0-0000-7000-8000-0000000000ee");
  expect(await screen.findByText("Dit bestaat niet meer.")).toBeVisible();
});

test("someone without a group to list who opens the members by URL is told no", async () => {
  // A platform admin gets the tabs without a working group; the list would be empty.
  const { calls } = mockFetch({
    "/api/me": platformAdminMeFixture,
    "/api/working-groups": directory,
  });
  renderApp("/app/more/members");
  expect(await screen.findByText("Dit mag je niet doen.")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Leden" })).toBeNull();
  expect(calls.some((path) => path.endsWith("/members"))).toBe(false);
});

test("an applicant who opens the members by URL stays on the picker", async () => {
  mockFetch({ "/api/me": applicantMeFixture, "/api/working-groups": directory });
  renderApp("/app/more/members");
  expect(await screen.findByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Leden" })).toBeNull();
});

describe("a coordinator of one group who is a volunteer of another", () => {
  const zuidOost = workingGroupsFixture.find((g) => g.name === "Zuid-Oost")!;
  const lotte = {
    membershipId: "0192f3c0-0000-7000-8000-0000000000e9",
    userId: "0192f3c0-0000-7000-8000-0000000000f9",
    name: "Lotte Smit",
    isCoordinator: false,
  };
  const me: MeResponse = {
    ...coordinatorMeFixture,
    memberships: [
      ...coordinatorMeFixture.memberships,
      { id: "0192f3c0-0000-7000-8000-0000000000c9", isCoordinator: false, workingGroup: zuidOost },
    ],
  };
  const routes = {
    "/api/me": me,
    "/api/working-groups": directory,
    [membersPath]: { members: membersWithContactFixture },
    [`/api/working-groups/${zuidOost.id}/members`]: { members: [lotte] },
  };

  test("opens the rows of the group they coordinate only", async () => {
    mockFetch(routes);
    renderApp("/app/more/members");
    expect(await screen.findByText("Lotte Smit")).toBeVisible();
    expect(screen.getByRole("button", { name: /Bram Jansen/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Lotte Smit/ })).toBeNull();
  });

  test("cannot remove a member of the group they volunteer in", async () => {
    mockFetch(routes);
    renderApp(`/app/more/members/${lotte.membershipId}`);
    expect(await screen.findByRole("heading", { name: "Lotte Smit" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Verwijder uit werkgroep" })).toBeNull();
  });
});
