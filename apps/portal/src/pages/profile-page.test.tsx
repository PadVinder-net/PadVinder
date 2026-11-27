import { mockFetch } from "@padvinder/api-client/testing";
import {
  applicantMeFixture,
  coordinatorMeFixture,
  meFixture,
  platformAdminMeFixture,
  twoOrganizationsMeFixture,
} from "@padvinder/contracts/fixtures";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { renderPortal } from "../testing/render-portal";
import { recordRequests, requestsTo } from "../testing/requests";

const organizationAdminMe = {
  ...applicantMeFixture,
  organizationAdminOf: twoOrganizationsMeFixture.organizationAdminOf,
};

test("the name in the header links to /profile, which saves the name and has no account deletion", async () => {
  const saved = { ...coordinatorMeFixture, user: { ...coordinatorMeFixture.user, name: "Nieuw" } };
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "PATCH /api/me": saved,
    "/api/managed-working-groups": { workingGroups: [] },
  });
  const requests = recordRequests();
  const { router } = renderPortal("/working-groups");
  const link = await screen.findByRole("link", { name: "Profiel" });
  expect(link).toHaveAttribute("href", "/profile");
  expect(link).toHaveTextContent(coordinatorMeFixture.user.name);
  await userEvent.click(link);
  expect(router.state.location.pathname).toBe("/profile");
  expect(await screen.findByRole("heading", { level: 1, name: "Profiel" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Verwijder account" })).toBeNull();

  const name = screen.getByLabelText("Naam");
  await userEvent.clear(name);
  await userEvent.type(name, "Nieuw");
  await userEvent.click(screen.getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Je gegevens zijn bewaard.")).toBeVisible();
  expect(requestsTo(requests, "PATCH", "/api/me")[0]!.body).toMatchObject({ name: "Nieuw" });
});

test("an admin sees Toegangssleutels on /profile", async () => {
  for (const me of [platformAdminMeFixture, organizationAdminMe]) {
    mockFetch({ "/api/me": me, "/api/managed-working-groups": { workingGroups: [] } });
    const { router } = renderPortal("/profile");
    const link = await screen.findByRole("link", { name: "Toegangssleutels" });
    expect(link).toHaveAttribute("href", "/profile/passkeys");
    await userEvent.click(link);
    expect(router.state.location.pathname).toBe("/profile/passkeys");
    cleanup();
  }
});

test("a coordinator does not see Toegangssleutels, and /profile/passkeys is not found for them", async () => {
  mockFetch({
    "/api/me": coordinatorMeFixture,
    "/api/managed-working-groups": { workingGroups: [] },
  });
  const requests = recordRequests();
  renderPortal("/profile");
  expect(await screen.findByRole("heading", { name: "Profiel" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Toegangssleutels" })).toBeNull();
  expect(screen.queryByText(/toegangssleutel/i)).toBeNull();
  expect(requestsTo(requests, "GET", "/api/passkeys")).toEqual([]);
});

test("a volunteer opening /profile/passkeys sees the not-found page without a request", async () => {
  mockFetch({ "/api/me": meFixture });
  const requests = recordRequests();
  renderPortal("/profile/passkeys");
  expect(
    await screen.findByRole("heading", { level: 1, name: "Deze pagina bestaat niet" }),
  ).toBeVisible();
  expect(requestsTo(requests, "GET", "/api/passkeys")).toEqual([]);
});
