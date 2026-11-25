import { mockFetch } from "@padvinder/api-client/testing";
import {
  applicantMeFixture,
  coordinatorMeFixture,
  meFixture,
  platformAdminMeFixture,
  speciesFixture,
} from "@padvinder/contracts/fixtures";
import { screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";

const notForYou = "Het portaal is voor coördinatoren en beheerders. Tellen doe je in de app.";

test("home sends a platform admin to /species", async () => {
  mockFetch({ "/api/me": platformAdminMeFixture, "/api/species": { species: speciesFixture } });
  const { router } = renderPortal("/");
  await waitFor(() => expect(router.state.location.pathname).toBe("/species"));
  // Replaced, not pushed: going back does not land on home, which would send them on again.
  expect(router.state.historyAction).toBe("REPLACE");
  expect(screen.queryByText(notForYou)).toBeNull();
  expect(await screen.findByRole("heading", { level: 1, name: "Soorten" })).toBeVisible();
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

test("home tells a coordinator there is nothing yet", async () => {
  mockFetch({ "/api/me": coordinatorMeFixture });
  const { router } = renderPortal("/");
  expect(
    await screen.findByText("Hier is nog niets te doen. Het beheer komt binnenkort."),
  ).toBeVisible();
  expect(screen.queryByText(notForYou)).toBeNull();
  expect(screen.queryByRole("link", { name: "Open de app" })).toBeNull();
  expect(router.state.location.pathname).toBe("/");
});
