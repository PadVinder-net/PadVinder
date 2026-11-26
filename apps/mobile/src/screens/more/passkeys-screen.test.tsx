import { createQueryClient } from "@padvinder/api-client";
import { mockFetch } from "@padvinder/api-client/testing";
import {
  coordinatorMeFixture,
  meFixture,
  passkeysFixture,
  platformAdminMeFixture,
  twoOrganizationsMeFixture,
} from "@padvinder/contracts/fixtures";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { errorResponse, renderApp } from "../../testing/render-app";

vi.mock("../../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

const withPasskey = {
  ...platformAdminMeFixture,
  user: { ...platformAdminMeFixture.user, hasPasskey: true },
};
const organizationAdminMe = {
  ...meFixture,
  organizationAdminOf: twoOrganizationsMeFixture.organizationAdminOf,
};

let restoreFetch: (() => void) | undefined;
/** Answers the requests that `match` by a function, the rest by what `mockFetch` set. */
function answerRequests(
  match: (url: URL, request: Request) => boolean,
  answer: () => Response | Promise<Response>,
) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    return match(new URL(request.url), request) ? answer() : inner(request);
  };
  restoreFetch = () => (globalThis.fetch = inner);
}

beforeEach(() => {
  vi.mocked(startAuthentication).mockResolvedValue({ id: "x" } as never);
  vi.mocked(startRegistration).mockResolvedValue({ id: "x" } as never);
});
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

test("Profiel shows Toegangssleutels for a platform admin and an organization admin, not for a coordinator or a volunteer", async () => {
  for (const [me, shown] of [
    [platformAdminMeFixture, true],
    [organizationAdminMe, true],
    [coordinatorMeFixture, false],
    [meFixture, false],
  ] as const) {
    mockFetch({ "/api/me": me });
    const { unmount } = renderApp("/app/more/profile");
    await screen.findByRole("heading", { name: "Profiel" });
    const link = screen.queryByRole("link", { name: "Toegangssleutels" });
    if (shown) expect(link).toHaveAttribute("href", "/app/more/profile/passkeys");
    else expect(link).toBeNull();
    if (!shown) expect(screen.queryByText(/toegangssleutel/i)).toBeNull();
    unmount();
  }
});

test("the passkeys screen lists and adds, without the phone hint", async () => {
  const list = { passkeys: [...passkeysFixture.passkeys] };
  mockFetch({
    "/api/me": withPasskey,
    "GET /api/passkeys": list,
    "POST /api/auth/passkey/generate-register-options": { challenge: "c" },
    "POST /api/auth/passkey/verify-registration": { ok: true },
  });
  renderApp("/app/more/profile/passkeys");
  expect(await screen.findByRole("heading", { name: "Toegangssleutels" })).toBeVisible();
  expect(await screen.findAllByRole("button", { name: "Verwijder" })).toHaveLength(2);
  expect(screen.queryByText(/Kies dan in het venster voor je telefoon/)).toBeNull();
  expect(screen.getByRole("link", { name: "Terug" })).toHaveAttribute("href", "/app/more/profile");
  await userEvent.click(screen.getByRole("button", { name: "Voeg een toegangssleutel toe" }));
  expect(await screen.findByRole("status")).toHaveTextContent("De toegangssleutel is toegevoegd.");
});

test("someone without an admin role gets the API's no on the passkeys screen", async () => {
  mockFetch({ "/api/me": coordinatorMeFixture });
  renderApp("/app/more/profile/passkeys");
  expect(await screen.findByText("Dit mag je niet doen.")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Toegangssleutels" })).toBeNull();
});

test("a passkey_required on the passkeys screen opens the modal; after confirming, the list shows", async () => {
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
  renderApp("/app/more/profile/passkeys", createQueryClient());
  const modal = await screen.findByRole("dialog", { name: "Bevestig dat jij het bent" });
  await userEvent.click(within(modal).getByRole("button", { name: "Gebruik je toegangssleutel" }));
  expect(await screen.findAllByRole("button", { name: "Verwijder" })).toHaveLength(2);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
