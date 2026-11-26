import { createQueryClient } from "@padvinder/api-client";
import { mockFetch } from "@padvinder/api-client/testing";
import {
  healthyFixture,
  managedWorkingGroupsFixture,
  membersWithContactFixture,
  platformAdminMeFixture,
  platformAdminsFixture,
  speciesFixture,
} from "@padvinder/contracts/fixtures";
import type { MeResponse } from "@padvinder/contracts";
import { startAuthentication } from "@simplewebauthn/browser";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderPortal } from "../testing/render-portal";
import { answerRequests, errorResponse } from "../testing/requests";

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

const unconfirmedAdmin: MeResponse = {
  ...platformAdminMeFixture,
  user: { ...platformAdminMeFixture.user, hasPasskey: true },
  adminConfirmedUntil: null,
};
const noord = managedWorkingGroupsFixture[0]!;
const confirmTitle = "Bevestig dat jij het bent";
const eye = "Toon met je toegangssleutel";

/** A passkey ceremony that works: from then on `confirmed()` is true. */
function workingCeremony() {
  const state = { confirmed: false };
  vi.mocked(startAuthentication).mockImplementation(async () => {
    state.confirmed = true;
    return { id: "x" } as never;
  });
  return state;
}

const ceremonyRoutes = {
  "POST /api/auth/passkey/generate-authenticate-options": { challenge: "c" },
  "POST /api/auth/passkey/verify-authentication": { ok: true },
};

/** The confirmation window opens when the ceremony ran: me then says so. */
function meNow(state: { confirmed: boolean }) {
  return (): Response =>
    Response.json(
      state.confirmed
        ? { ...unconfirmedAdmin, adminConfirmedUntil: "2099-01-01T00:00:00.000Z" }
        : unconfirmedAdmin,
    );
}

async function confirmInModal() {
  const modal = await screen.findByRole("dialog", { name: confirmTitle });
  await userEvent.click(within(modal).getByRole("button", { name: "Gebruik je toegangssleutel" }));
}

test("an unconfirmed admin opening Werkgroepen sees the modal once; after confirming, the list", async () => {
  const state = workingCeremony();
  mockFetch({ ...ceremonyRoutes });
  answerRequests(
    (url) => url.pathname === "/api/me",
    () => meNow(state)(),
  );
  answerRequests(
    (url) => url.pathname === "/api/managed-working-groups",
    () =>
      state.confirmed
        ? Response.json({ workingGroups: managedWorkingGroupsFixture })
        : errorResponse(403, "passkey_required"),
  );
  renderPortal("/working-groups", createQueryClient());
  await confirmInModal();
  expect(await screen.findByRole("cell", { name: noord.name })).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: confirmTitle })).toBeNull());
  expect(vi.mocked(startAuthentication)).toHaveBeenCalledTimes(1);
});

test("on another page, a passkey_required of the badge does not open the modal and the badge shows no number", async () => {
  mockFetch({
    "/api/me": unconfirmedAdmin,
    "/api/species": { species: speciesFixture },
    "/api/managed-working-groups": errorResponse(403, "passkey_required"),
  });
  renderPortal("/species", createQueryClient());
  expect(await screen.findByRole("cell", { name: "Gewone pad" })).toBeVisible();
  const link = await screen.findByRole("link", { name: "Aanmeldingen" });
  expect(link.textContent).toBe("Aanmeldingen");
  expect(screen.queryByRole("dialog", { name: confirmTitle })).toBeNull();
});

test("a member list with passkeyReveals shows the bars; the eye confirms and the addresses show", async () => {
  const state = workingCeremony();
  const hidden = membersWithContactFixture.map(
    ({ email: _email, phone: _phone, hasLoggedIn: _logged, ...rest }) => rest,
  );
  mockFetch({
    ...ceremonyRoutes,
    "/api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
  });
  answerRequests(
    (url) => url.pathname === "/api/me",
    () => meNow(state)(),
  );
  answerRequests(
    (url) => url.pathname === `/api/working-groups/${noord.id}/members`,
    () =>
      Response.json(
        state.confirmed
          ? { members: membersWithContactFixture }
          : { members: hidden, passkeyReveals: ["email", "phone", "hasLoggedIn"] },
      ),
  );
  renderPortal(`/working-groups/${noord.id}`, createQueryClient());
  const eyes = await screen.findAllByRole("button", { name: eye });
  expect(screen.queryByText(membersWithContactFixture[0]!.email!)).toBeNull();
  await userEvent.click(eyes[0]!);
  await confirmInModal();
  expect(await screen.findByText(membersWithContactFixture[0]!.email!)).toBeVisible();
  expect(screen.queryByRole("button", { name: eye })).toBeNull();
});

test("/system shows the bar for an unconfirmed platform admin; the eye confirms and the versions show", async () => {
  const state = workingCeremony();
  mockFetch({ ...ceremonyRoutes });
  answerRequests(
    (url) => url.pathname === "/api/me",
    () => meNow(state)(),
  );
  answerRequests(
    (url) => url.pathname === "/api/health",
    () =>
      Response.json(
        state.confirmed
          ? healthyFixture
          : {
              ...healthyFixture,
              database: {
                reachable: true,
                detailsHidden: true,
                postgresVersion: null,
                postgisVersion: null,
                latestMigration: null,
              },
              passkeyReveals: ["database"],
            },
      ),
  );
  renderPortal("/system", createQueryClient());
  await userEvent.click(await screen.findByRole("button", { name: eye }));
  await confirmInModal();
  expect(await screen.findByText(/18\.7/)).toBeVisible();
  expect(screen.queryByRole("button", { name: eye })).toBeNull();
});

test("appointing a platform admin after a confirmation closes the dialog with its toast", async () => {
  const state = workingCeremony();
  mockFetch({
    ...ceremonyRoutes,
    "GET /api/platform-admins": { platformAdmins: platformAdminsFixture },
    "/api/managed-working-groups": { workingGroups: managedWorkingGroupsFixture },
  });
  answerRequests(
    (url) => url.pathname === "/api/me",
    () => meNow(state)(),
  );
  answerRequests(
    (url, request) => url.pathname === "/api/platform-admins" && request.method === "POST",
    () =>
      state.confirmed
        ? Response.json(platformAdminsFixture[0], { status: 201 })
        : errorResponse(403, "passkey_required"),
  );
  renderPortal("/platform-admins", createQueryClient());
  await userEvent.click(await screen.findByRole("button", { name: "Voeg hoofdbeheerder toe" }));
  const dialog = await screen.findByRole("dialog", { name: "Hoofdbeheerder toevoegen" });
  await userEvent.type(within(dialog).getByLabelText("E-mailadres"), "nieuw@example.test");
  await userEvent.click(within(dialog).getByRole("button", { name: "Ga verder" }));
  await userEvent.click(await within(dialog).findByRole("button", { name: "Maak hoofdbeheerder" }));
  await confirmInModal();
  expect(await screen.findByText("nieuw@example.test is hoofdbeheerder.")).toBeVisible();
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Hoofdbeheerder toevoegen" })).toBeNull(),
  );
});

test("Annuleer in the modal leaves the species dialog open with Bevestig eerst met je toegangssleutel.", async () => {
  mockFetch({ "/api/me": unconfirmedAdmin, "/api/species": { species: speciesFixture } });
  answerRequests(
    (url, request) => url.pathname === "/api/species" && request.method === "POST",
    () => errorResponse(403, "passkey_required"),
  );
  renderPortal("/species", createQueryClient());
  await userEvent.click(await screen.findByRole("button", { name: "Nieuwe soort" }));
  const dialog = await screen.findByRole("dialog", { name: "Nieuwe soort" });
  await userEvent.type(within(dialog).getByLabelText("Nederlandse naam"), "vroedmeesterpad");
  await userEvent.type(
    within(dialog).getByLabelText("Wetenschappelijke naam"),
    "Alytes obstetricans",
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "Bewaar" }));
  const modal = await screen.findByRole("dialog", { name: confirmTitle });
  await userEvent.click(within(modal).getByRole("button", { name: "Annuleer" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: confirmTitle })).toBeNull());
  expect(screen.getByRole("dialog", { name: "Nieuwe soort" })).toBeVisible();
  expect(screen.getByText("Bevestig eerst met je toegangssleutel.")).toBeVisible();
});
