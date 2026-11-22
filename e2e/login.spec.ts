import { expect, test, type Page } from "@playwright/test";
import { newAddress, readLoginCode } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";

async function askForCode(page: Page, address: string): Promise<void> {
  await page.goto("/app/");
  await page.getByLabel("E-mailadres").fill(address);
  await page.getByRole("button", { name: "Stuur code" }).click();
  await expect(page.getByRole("heading", { name: "Vul je code in" })).toBeVisible();
}

test("a new volunteer logs in with a code from the mail", async ({ page }) => {
  const address = newAddress("noor");
  await askForCode(page, address);
  await page.getByLabel("Code").fill(await readLoginCode(address));
  await expect(page.getByRole("heading", { name: "Hoe heet je?" })).toBeVisible();
  await page.getByLabel("Naam").fill("Noor de Vries");
  await page.getByRole("button", { name: "Ga verder" }).click();
  await expect(page.getByRole("link", { name: "Meer" })).toBeVisible();
});

test("a wrong code shows the message", async ({ page }) => {
  const address = newAddress("wrong");
  await askForCode(page, address);
  const code = await readLoginCode(address);
  await page.getByLabel("Code").fill(code === "000000" ? "111111" : "000000");
  await expect(page.getByText("Deze code klopt niet. Kijk nog eens in je mail.")).toBeVisible();

  // The field is empty again, and the right code still works.
  await expect(page.getByLabel("Code")).toHaveValue("");
  await page.getByLabel("Code").fill(code);
  await expect(page.getByRole("heading", { name: "Hoe heet je?" })).toBeVisible();
});

test("logging out returns to the login screen, also after a reload", async ({ page, context }) => {
  await createSession(context, newAddress("logout"));
  await page.goto("/app/more");
  await page.getByRole("button", { name: "Log uit" }).click();
  const loginHeading = page.getByRole("heading", { name: "Log in bij PadVinder" });
  await expect(loginHeading).toBeVisible();

  await page.reload();
  await expect(loginHeading).toBeVisible();
  await expect(page.getByRole("link", { name: "Meer" })).toHaveCount(0);
});

test("the session survives a reload", async ({ page }) => {
  const address = newAddress("reload");
  await askForCode(page, address);
  await page.getByLabel("Code").fill(await readLoginCode(address));
  await page.getByLabel("Naam").fill("Sem Bakker");
  await page.getByRole("button", { name: "Ga verder" }).click();
  await expect(page.getByRole("link", { name: "Meer" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("link", { name: "Meer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Log in bij PadVinder" })).toHaveCount(0);
});
