import { mockFetch } from "@padvinder/api-client/testing";
import {
  applicantMeFixture,
  coordinatorMeFixture,
  managedWorkingGroupsFixture,
  meFixture,
  platformAdminMeFixture,
} from "@padvinder/contracts/fixtures";
import { screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";

const notForYou = "Het portaal is voor coördinatoren en beheerders. Tellen doe je in de app.";

const managed = { workingGroups: managedWorkingGroupsFixture };

test("home sends a platform admin to /working-groups", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture, "/api/managed-working-groups": managed });
  const { router } = renderPortal("/");
  await waitFor(() => expect(router.state.location.pathname).toBe("/working-groups"));
  // Replaced, not pushed: going back does not land on home, which would send them on again.
  expect(router.state.historyAction).toBe("REPLACE");
  expect(screen.queryByText(notForYou)).toBeNull();
  expect(await screen.findByRole("heading", { level: 1, name: "Werkgroepen" })).toBeVisible();
});

test("home tells a volunteer the portal is not for them, with a link to /app/", async () => {
  mockFetch({ "/api/me": meFixture });
  renderPortal("/");
  expect(await screen.findByText(notForYou)).toBeVisible();
  expect(screen.getByRole("link", { name: "Open de app" })).toHaveAttribute("href", "/app/");
  expect(screen.getByRole("button", { name: "Log uit" })).toBeVisible();
  expect(screen.queryByText("Hier is nog niets te doen. Het beheer komt binnenkort.")).toBeNull();
});

test("home tells an applicant the same", async () => {
  mockFetch({ "/api/me": applicantMeFixture });
  renderPortal("/");
  expect(await screen.findByText(notForYou)).toBeVisible();
  expect(screen.getByRole("link", { name: "Open de app" })).toHaveAttribute("href", "/app/");
});

test("home sends a coordinator to /working-groups", async () => {
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/managed-working-groups": { workingGroups: [managedWorkingGroupsFixture[0]!] },
  });
  const { router } = renderPortal("/");
  await waitFor(() => expect(router.state.location.pathname).toBe("/working-groups"));
  expect(router.state.historyAction).toBe("REPLACE");
  expect(await screen.findByRole("heading", { level: 1, name: "Werkgroepen" })).toBeVisible();
  expect(screen.queryByText(notForYou)).toBeNull();
  expect(screen.queryByText("Hier is nog niets te doen. Het beheer komt binnenkort.")).toBeNull();
});
