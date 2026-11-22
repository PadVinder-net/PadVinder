import { expect, test } from "@playwright/test";
import { runAdmin } from "./helpers/admin.ts";
import { newAddress } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";

test("a platform admin sees a working system on the Meer tab", async ({ page, context }) => {
  const address = newAddress("admin");
  runAdmin("grant-platform-admin", "--email", address);
  await createSession(context, address);
  await page.goto("/app/");
  await page.getByRole("link", { name: "Meer" }).click();
  await expect(page).toHaveURL(/\/app\/more$/);
  await expect(page.getByRole("heading", { name: "Systeemstatus" })).toBeVisible();
  await expect(page.getByText("Alles werkt")).toBeVisible({ timeout: 15_000 });
});

test("a volunteer does not see the system status", async ({ page, context }) => {
  // A fresh account holds no role at all; for this screen it is the same as a volunteer.
  await createSession(context, newAddress("volunteer"));
  await page.goto("/app/more");
  // The tab renders after /api/me has loaded, so the status would be there by now.
  await expect(page.getByRole("button", { name: "Log uit" })).toBeVisible();
  // Matches the heading and the loading text alike.
  await expect(page.getByText("Systeemstatus")).toHaveCount(0);
});

test("a deep link to /app/more works on reload", async ({ page, context }) => {
  await createSession(context, newAddress("system"));
  await page.goto("/app/more");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Meer" })).toBeVisible();
});
