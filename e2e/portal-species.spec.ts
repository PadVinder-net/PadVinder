import { expect, test, type Page } from "@playwright/test";
import { runAdmin } from "./helpers/admin.ts";
import { newAddress, randomWord } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";
import { createWorkingGroup, makeVolunteer } from "./helpers/working-groups.ts";

// A species cannot be deleted, so every run leaves its species behind in the dev database. They
// are named "e2e-soort <random letters>", and the test that makes one switches it off at the end.

async function logInAsPlatformAdmin(page: Page, label: string): Promise<void> {
  const address = newAddress(label);
  runAdmin("grant-platform-admin", "--email", address);
  await createSession(page.context(), address);
}

/** Fills the open species form and saves it. */
async function fillSpeciesForm(page: Page, dutchName: string, scientificName: string) {
  const form = page.getByRole("dialog");
  await form.getByLabel("Nederlandse naam").fill(dutchName);
  await form.getByLabel("Wetenschappelijke naam").fill(scientificName);
  await form.getByRole("button", { name: "Bewaar" }).click();
}

test("a platform admin adds, renames and switches off a species", async ({ page }) => {
  await logInAsPlatformAdmin(page, "soorten");
  await page.goto("/");
  await expect(page).toHaveURL(/\/species$/);
  await expect(page.getByRole("heading", { name: "Soorten" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Gewone pad", exact: true })).toBeVisible();

  const word = randomWord();
  await page.getByRole("button", { name: "Nieuwe soort" }).click();
  await fillSpeciesForm(page, `e2e-soort ${word}`, `Testus ${word}`);
  await expect(page.getByText(`E2e-soort ${word} is toegevoegd.`)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const added = page.getByRole("row").filter({ hasText: `Testus ${word}` });
  await expect(added.getByRole("cell").first()).toHaveText(`E2e-soort ${word}`);

  await added.getByRole("button", { name: "Wijzig" }).click();
  await page.getByRole("dialog").getByLabel("Nederlandse naam").fill(`e2e-soort ${word} twee`);
  await page.getByRole("dialog").getByRole("button", { name: "Bewaar" }).click();
  await expect(page.getByText(`E2e-soort ${word} twee is gewijzigd.`)).toBeVisible();
  await expect(added.getByRole("cell").first()).toHaveText(`E2e-soort ${word} twee`);

  await added.getByRole("button", { name: "Zet uit" }).click();
  const question = page.getByRole("alertdialog");
  await expect(question).toContainText(`E2e-soort ${word} twee uitzetten?`);
  await question.getByRole("button", { name: "Zet uit" }).click();
  await expect(page.getByText(`E2e-soort ${word} twee staat uit.`)).toBeVisible();
  // The columns: Nederlandse naam, Wetenschappelijke naam, Betrouwbaarheidscheck, Actief.
  await expect(added.getByRole("cell").nth(3)).toHaveText("nee");
  await expect(added.getByRole("button", { name: "Zet aan" })).toBeVisible();
});

test("a taken name shows the text under the field", async ({ page }) => {
  await logInAsPlatformAdmin(page, "soorten-dubbel");
  await page.goto("/species");
  await page.getByRole("button", { name: "Nieuwe soort" }).click();
  await fillSpeciesForm(page, "gewone pad", `Testus ${randomWord()}`);
  const form = page.getByRole("dialog");
  await expect(form.getByText("Er is al een soort met deze Nederlandse naam.")).toBeVisible();
  await expect(form.getByLabel("Nederlandse naam")).toHaveAttribute("aria-invalid", "true");
});

test("a volunteer sees that the portal is not for them", async ({ page }) => {
  const address = newAddress("vrijwilliger");
  makeVolunteer(address, createWorkingGroup().id);
  await createSession(page.context(), address);
  await page.goto("/");
  await expect(page.getByText("Het portaal is voor coördinatoren en beheerders.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Beheer" })).toHaveCount(0);
  await page.goto("/species");
  await expect(page.getByRole("heading", { name: "Deze pagina bestaat niet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Nieuwe soort" })).toHaveCount(0);
});
