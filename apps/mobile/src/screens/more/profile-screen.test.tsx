import { meFixture, workingGroupsFixture } from "@padvinder/contracts/fixtures";
import { mockFetch } from "@padvinder/api-client/testing";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { errorResponse, notLoggedIn, renderApp } from "../../testing/render-app";

vi.mock("../../hooks/use-service-worker", () => ({
  useServiceWorker: () => ({ needRefresh: false, checking: false, applyUpdate: vi.fn() }),
}));

const directory = { workingGroups: workingGroupsFixture };

test("saving the profile shows the saved text", async () => {
  mockFetch({
    "/api/me": meFixture,
    "PATCH /api/me": { ...meFixture, user: { ...meFixture.user, phone: "06 11112222" } },
  });
  renderApp("/app/more/profile");
  expect(await screen.findByRole("heading", { name: "Profiel" })).toBeVisible();
  expect(screen.getByText("noor@example.test")).toBeVisible();
  expect(screen.getByRole("link", { name: "Terug" })).toHaveAttribute("href", "/app/more");
  await userEvent.type(screen.getByLabelText("Telefoonnummer (optioneel)"), "06 11112222");
  await userEvent.click(screen.getByRole("button", { name: "Bewaar" }));
  expect(await screen.findByText("Je gegevens zijn bewaard.")).toBeVisible();
});

test("deleting the account ends at the login screen with the notice", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": meFixture,
    "/api/working-groups": directory,
    "DELETE /api/me": new Response(null, { status: 204 }),
  };
  mockFetch(routes);
  renderApp("/app/more/profile");
  await userEvent.click(await screen.findByRole("button", { name: "Verwijder account" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Account verwijderen?" });
  routes["/api/me"] = notLoggedIn();
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder account" }));
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Je account is verwijderd.");
});

test("the last platform admin keeps the account and reads why", async () => {
  mockFetch({
    "/api/me": { ...meFixture, user: { ...meFixture.user, isPlatformAdmin: true } },
    "DELETE /api/me": errorResponse(409, "last_platform_admin"),
  });
  renderApp("/app/more/profile");
  await userEvent.click(await screen.findByRole("button", { name: "Verwijder account" }));
  const dialog = await screen.findByRole("alertdialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder account" }));
  expect(
    await within(dialog).findByText(
      "Je bent de enige hoofdbeheerder. Maak eerst iemand anders hoofdbeheerder.",
    ),
  ).toBeVisible();
});

test("the deletion notice is gone after logging in again and out", async () => {
  const routes: Record<string, unknown> = {
    "/api/me": meFixture,
    "/api/working-groups": directory,
    "DELETE /api/me": new Response(null, { status: 204 }),
    "/api/auth/email-otp/send-verification-otp": { success: true },
    "/api/auth/sign-in/email-otp": { token: "x", user: {} },
    "/api/auth/sign-out": { success: true },
  };
  mockFetch(routes);
  const { router } = renderApp("/app/more/profile");
  await userEvent.click(await screen.findByRole("button", { name: "Verwijder account" }));
  const dialog = await screen.findByRole("alertdialog");
  routes["/api/me"] = notLoggedIn();
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder account" }));
  expect(await screen.findByText("Je account is verwijderd.")).toBeVisible();

  await userEvent.type(screen.getByLabelText("E-mailadres"), "noor@example.test");
  await userEvent.click(screen.getByRole("button", { name: "Stuur code" }));
  routes["/api/me"] = meFixture;
  await userEvent.type(await screen.findByLabelText("Code"), "123456");
  await screen.findByRole("heading", { name: "Profiel" });
  await router.navigate("/more");
  routes["/api/me"] = notLoggedIn();
  await userEvent.click(await screen.findByRole("button", { name: "Log uit" }));
  expect(await screen.findByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
  expect(screen.queryByText("Je account is verwijderd.")).toBeNull();
});
