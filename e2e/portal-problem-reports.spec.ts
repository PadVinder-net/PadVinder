import { expect, test } from "@playwright/test";
import { newAddress } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";

// Under the dev server Sentry is off and the API has no SENTRY_BROWSER_DSN: it answers 204 for a report.

test("Meld een probleem in the navigation opens the form in a modal", async ({ page }) => {
  // Anyone who sees the portal may report, also someone without a role.
  const address = newAddress("portal-report");
  await createSession(page.context(), address, { name: "Anne de Vries" });
  await page.goto("/");
  await page.getByRole("button", { name: "Meld een probleem" }).click();
  const dialog = page.getByRole("dialog", { name: "Meld een probleem" });
  await expect(dialog.getByText(address)).toBeVisible();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByLabel("Wat ging er mis?").fill("De pagina bleef leeg.");
  await dialog.getByRole("checkbox").click();
  await dialog.getByRole("button", { name: "Verstuur" }).click();
  await expect(page.getByText("Bedankt, je melding is verstuurd.")).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test("a crash in a page shows the portal's crash screen, from which a report goes out", async ({
  page,
}) => {
  await createSession(page.context(), newAddress("portal-crash"));
  await page.goto("/dev/crash");
  await expect(page.getByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  await expect(
    page.getByText(
      "De pagina liep vast. Laad de pagina opnieuw. Gaat het weer mis? Vertel ons wat je deed.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Vertel wat er gebeurde" }).click();
  await page.getByLabel("Wat ging er mis?").fill("Ik opende de testpagina.");
  await page.getByRole("button", { name: "Verstuur" }).click();
  await expect(page.getByText("Bedankt, je melding is verstuurd.")).toBeVisible();
});

test("a crash before login offers only Laad opnieuw", async ({ page }) => {
  const me = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/me");
  await page.goto("/dev/crash-outside-router");
  await expect(page.getByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  expect((await me).status()).toBe(401);
  await expect(page.getByRole("button")).toHaveText(["Laad opnieuw"]);
});
