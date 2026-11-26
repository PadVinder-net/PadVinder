import { expect, test } from "@playwright/test";
import { runAdmin } from "./helpers/admin.ts";
import { newAddress } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";

// Under the dev server Sentry is off and the API has no SENTRY_BROWSER_DSN: it answers 204 for a report.

const contactLabel = "Stuur mijn naam en e-mailadres mee, zodat we je kunnen mailen";

test("Meer, Meld een probleem sends a report and thanks", async ({ page, context }) => {
  // A platform admin gets the tabs without a working group; a fresh account would get the picker.
  const address = newAddress("report");
  runAdmin("grant-platform-admin", "--email", address);
  await createSession(context, address, { name: "Anne de Vries" });
  await page.goto("/app/more");
  await page.getByRole("link", { name: "Meld een probleem" }).click();
  await expect(page).toHaveURL(/\/app\/more\/report-problem$/);
  await expect(page.getByRole("heading", { name: "Meld een probleem" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: contactLabel })).not.toBeChecked();
  await expect(page.getByText("Anne de Vries")).toBeVisible();
  await expect(page.getByText(address)).toBeVisible();
  const send = page.getByRole("button", { name: "Verstuur" });
  await expect(send).toBeDisabled();
  await page.getByLabel("Wat ging er mis?").fill("De kaart blijft leeg.");
  await page.getByText(contactLabel).click();
  await send.click();
  await expect(page.getByText("Bedankt, je melding is verstuurd.")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/more$/);
});

test("a crash in a screen shows the crash screen, from which a report goes out", async ({
  page,
  context,
}) => {
  const address = newAddress("crash");
  runAdmin("grant-platform-admin", "--email", address);
  await createSession(context, address);
  await page.goto("/app/dev/crash");
  await expect(page.getByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  await expect(
    page.getByText(
      "De app liep vast. Laad de app opnieuw. Gaat het weer mis? Vertel ons wat je deed.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Laad opnieuw" })).toBeVisible();
  await page.getByRole("button", { name: "Vertel wat er gebeurde" }).click();
  await page.getByLabel("Wat ging er mis?").fill("Ik opende de testpagina.");
  await page.getByRole("button", { name: "Verstuur" }).click();
  await expect(page.getByText("Bedankt, je melding is verstuurd.")).toBeVisible();
  await page.getByRole("button", { name: "Laad opnieuw" }).click();
  await expect(page.getByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
});

test("a crash before login offers only Laad opnieuw", async ({ page }) => {
  const me = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/me");
  await page.goto("/app/dev/crash-outside-router");
  await expect(page.getByRole("heading", { name: "Er ging iets mis" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Laad opnieuw" })).toBeVisible();
  // Nobody is logged in: /api/me answers 401, and the report button stays away.
  expect((await me).status()).toBe(401);
  await expect(page.getByRole("button", { name: "Vertel wat er gebeurde" })).toHaveCount(0);
});
