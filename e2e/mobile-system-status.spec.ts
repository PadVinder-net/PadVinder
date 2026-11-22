import { expect, test } from "@playwright/test";
import { newAddress } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";

test.beforeEach(async ({ context }) => {
  await createSession(context, newAddress("system"));
});

test("the Meer tab shows a working system", async ({ page }) => {
  await page.goto("/app/");
  await page.getByRole("link", { name: "Meer" }).click();
  await expect(page).toHaveURL(/\/app\/more$/);
  await expect(page.getByRole("heading", { name: "Systeemstatus" })).toBeVisible();
  await expect(page.getByText("Alles werkt")).toBeVisible({ timeout: 15_000 });
});

test("a deep link to /app/more works on reload", async ({ page }) => {
  await page.goto("/app/more");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Meer" })).toBeVisible();
});
