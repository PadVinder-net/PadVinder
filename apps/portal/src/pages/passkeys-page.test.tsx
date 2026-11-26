import { createQueryClient } from "@padvinder/api-client";
import { mockFetch } from "@padvinder/api-client/testing";
import {
  organizationDetailFixture,
  passkeysFixture,
  platformAdminMeFixture,
} from "@padvinder/contracts/fixtures";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { renderPortal } from "../testing/render-portal";
import {
  answerRequests,
  errorResponse,
  holdRequests,
  recordRequests,
  requestsTo,
} from "../testing/requests";

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

const withPasskey = {
  ...platformAdminMeFixture,
  user: { ...platformAdminMeFixture.user, hasPasskey: true },
};
const [first, second] = passkeysFixture.passkeys as [
  (typeof passkeysFixture.passkeys)[number],
  (typeof passkeysFixture.passkeys)[number],
];

beforeEach(() => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
  vi.mocked(startAuthentication).mockResolvedValue({ id: "x" } as never);
  vi.mocked(startRegistration).mockResolvedValue({ id: "x" } as never);
});

test("the passkeys page lists, adds and removes, with the phone hint", async () => {
  const list = { passkeys: [...passkeysFixture.passkeys] };
  mockFetch({
    "/api/me": withPasskey,
    "GET /api/passkeys": list,
    [`DELETE /api/passkeys/${first.id}`]: new Response(null, { status: 204 }),
  });
  const requests = recordRequests();
  renderPortal("/profile/passkeys");
  expect(await screen.findByRole("heading", { name: "Toegangssleutels" })).toBeVisible();
  expect(await screen.findAllByRole("button", { name: "Verwijder" })).toHaveLength(2);
  expect(screen.getByText(/Kies dan in het venster voor je telefoon/)).toBeVisible();

  await userEvent.click(screen.getAllByRole("button", { name: "Verwijder" })[0]!);
  const dialog = await screen.findByRole("alertdialog");
  list.passkeys = [second];
  // The answer comes a moment later, as over a network: the dialog sees the removal running.
  const release = holdRequests((request) => request.method === "DELETE");
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: /Even geduld/ })).toBeVisible(),
  );
  release();
  expect(await screen.findByText("De toegangssleutel is verwijderd.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(requestsTo(requests, "DELETE", "/api/passkeys")).toHaveLength(1);
});

test("adding a passkey shows its toast when the list has grown", async () => {
  const list = { passkeys: [first] };
  mockFetch({
    "/api/me": withPasskey,
    "GET /api/passkeys": list,
    "POST /api/auth/passkey/generate-register-options": { challenge: "c" },
    "POST /api/auth/passkey/verify-registration": { ok: true },
  });
  renderPortal("/profile/passkeys");
  await screen.findByRole("button", { name: "Verwijder" });
  list.passkeys = [first, second];
  await userEvent.click(screen.getByRole("button", { name: "Voeg een toegangssleutel toe" }));
  expect(await screen.findByText("De toegangssleutel is toegevoegd.")).toBeVisible();
  expect(await screen.findAllByRole("button", { name: "Verwijder" })).toHaveLength(2);
});

test("an admin without a passkey shows Nog geen toegangssleutel on the organization page", async () => {
  const organizationId = organizationDetailFixture.id;
  mockFetch({
    "/api/me": platformAdminMeFixture,
    [`/api/organizations/${organizationId}`]: organizationDetailFixture,
    "/api/managed-working-groups": { workingGroups: [] },
  });
  renderPortal(`/organizations/${organizationId}`);
  expect(await screen.findByText("Nog geen toegangssleutel")).toBeVisible();
});

test("a passkey_required on the list opens the modal; after confirming, the list shows", async () => {
  let confirmed = false;
  mockFetch({
    "/api/me": withPasskey,
    "POST /api/auth/passkey/generate-authenticate-options": { challenge: "c" },
    "POST /api/auth/passkey/verify-authentication": { ok: true },
  });
  answerRequests(
    (url, request) => url.pathname === "/api/passkeys" && request.method === "GET",
    () => (confirmed ? Response.json(passkeysFixture) : errorResponse(403, "passkey_required")),
  );
  vi.mocked(startAuthentication).mockImplementation(async () => {
    confirmed = true;
    return { id: "x" } as never;
  });
  renderPortal("/profile/passkeys", createQueryClient());
  const modal = await screen.findByRole("dialog", { name: "Bevestig dat jij het bent" });
  await userEvent.click(within(modal).getByRole("button", { name: "Gebruik je toegangssleutel" }));
  expect(await screen.findAllByRole("button", { name: "Verwijder" })).toHaveLength(2);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("Annuleer in the modal leaves the page's load error with Probeer opnieuw", async () => {
  mockFetch({ "/api/me": withPasskey });
  answerRequests(
    (url) => url.pathname === "/api/passkeys",
    () => errorResponse(403, "passkey_required"),
  );
  renderPortal("/profile/passkeys", createQueryClient());
  const modal = await screen.findByRole("dialog", { name: "Bevestig dat jij het bent" });
  await userEvent.click(within(modal).getByRole("button", { name: "Annuleer" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await screen.findByRole("button", { name: "Probeer opnieuw" })).toBeVisible();
  // Asking again opens the modal again.
  await userEvent.click(screen.getByRole("button", { name: "Probeer opnieuw" }));
  expect(await screen.findByRole("dialog", { name: "Bevestig dat jij het bent" })).toBeVisible();
});
