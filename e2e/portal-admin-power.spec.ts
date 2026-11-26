import { devices, expect, test, type Page } from "@playwright/test";
import { confirmSession } from "./helpers/database.ts";
import { runAdmin } from "./helpers/admin.ts";
import { join } from "./helpers/joining.ts";
import { newAddress, randomWord, readLoginCode } from "./helpers/mailpit.ts";
import { addVirtualAuthenticator } from "./helpers/passkeys.ts";
import { createSession } from "./helpers/session.ts";
import {
  addWorkingGroup,
  createWorkingGroup,
  makeCoordinator,
  makeVolunteer,
} from "./helpers/working-groups.ts";

// Admin power needs a passkey: these tests meet the confirmation modal on purpose. The other
// portal tests confirm their session through the database first (`confirmSession`).

function appOrigin(): string {
  const port = process.env.MOBILE_PORT;
  if (!port) throw new Error("MOBILE_PORT is not set. Run scripts/setup-workspace.sh.");
  return `http://localhost:${port}`;
}

/** The first passkey, made in the modal that opens on /profile/passkeys. */
async function makeFirstPasskey(page: Page): Promise<void> {
  await page.goto("/profile/passkeys");
  const modal = page.getByRole("dialog", { name: "Maak een toegangssleutel" });
  await modal.getByRole("button", { name: "Maak een toegangssleutel" }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Toegevoegd op" })).toHaveCount(1);
}

test("an organization admin logs in with a code, opens Werkgroepen, makes a passkey in the modal and sees the page", async ({
  page,
}) => {
  const group = createWorkingGroup();
  const authenticator = await addVirtualAuthenticator(page);
  try {
    await page.goto("/");
    await page.getByLabel("E-mailadres").fill(group.adminAddress);
    await page.getByRole("button", { name: "Stuur code" }).click();
    await expect(page.getByRole("heading", { name: "Vul je code in" })).toBeVisible();
    await page.getByLabel("Code").fill(await readLoginCode(group.adminAddress));
    await expect(page.getByRole("heading", { name: "Hoe heet je?" })).toBeVisible();
    await page.getByLabel("Naam").fill(`Bram ${randomWord()}`);
    await page.getByRole("button", { name: "Ga verder" }).click();

    // A session from a code is not confirmed: the list waits for a passkey.
    await expect(page).toHaveURL(/\/working-groups$/);
    const modal = page.getByRole("dialog", { name: "Maak een toegangssleutel" });
    await expect(modal).toBeVisible();
    await expect(page.getByRole("button", { name: group.name })).toHaveCount(0);
    await modal.getByRole("button", { name: "Maak een toegangssleutel" }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByRole("button", { name: group.name })).toBeVisible();
  } finally {
    await authenticator.remove();
  }
});

test("a platform admin deletes an account after confirming again", async ({ page, browser }) => {
  const group = createWorkingGroup();
  const volunteer = newAddress("vrijwilliger");
  const volunteerName = `Vera ${randomWord()}`;
  makeVolunteer(volunteer, group.id);
  const volunteerContext = await browser.newContext();
  try {
    await createSession(volunteerContext, volunteer, { name: volunteerName });

    const platformAdmin = newAddress("hoofdbeheerder");
    runAdmin("grant-platform-admin", "--email", platformAdmin);
    await createSession(page.context(), platformAdmin, { name: `Hanna ${randomWord()}` });
    const authenticator = await addVirtualAuthenticator(page);
    try {
      await makeFirstPasskey(page);
      // The confirmation is 11 minutes old: still good for reading, too old for deleting.
      await confirmSession(page.context(), { minutesAgo: 11 });

      await page.goto("/delete-account");
      await page.getByLabel("E-mailadres").fill(volunteer);
      await page.getByRole("button", { name: "Zoek" }).click();
      await expect(page.getByRole("heading", { name: volunteerName })).toBeVisible();

      await page.getByRole("button", { name: "Verwijder account" }).click();
      const question = page.getByRole("alertdialog", {
        name: `Account van ${volunteerName} verwijderen?`,
      });
      await question.getByRole("button", { name: "Verwijder account" }).click();

      const modal = page.getByRole("dialog", { name: "Bevestig dat jij het bent" });
      await expect(modal).toBeVisible();
      await modal.getByRole("button", { name: "Gebruik je toegangssleutel" }).click();

      await expect(page.getByText(`Het account van ${volunteerName} is verwijderd.`)).toBeVisible();
      await expect(modal).toHaveCount(0);
    } finally {
      await authenticator.remove();
    }
  } finally {
    await volunteerContext.close();
  }
});

test("an unconfirmed organization admin who coordinates a group uses it in the app without a modal", async ({
  browser,
}) => {
  const group = createWorkingGroup();
  const other = addWorkingGroup(group.organizationId);
  // The admin coordinates the first group only.
  makeCoordinator(group.adminAddress, group.id);

  // Noor asks for the first group, so there is a request to see.
  const noorName = `Noor ${randomWord()}`;
  const noor = await browser.newContext({ ...devices["Pixel 7"], baseURL: appOrigin() });
  const adminContext = await browser.newContext({ ...devices["Pixel 7"], baseURL: appOrigin() });
  try {
    await createSession(noor, newAddress("noor"), { name: noorName });
    const noorPage = await noor.newPage();
    await noorPage.goto("/app/");
    await join(noorPage, group.name);

    // Logged in by a code only: no confirmation.
    await createSession(adminContext, group.adminAddress, { name: `Bram ${randomWord()}` });
    const page = await adminContext.newPage();
    await page.goto("/app/more/membership-requests");
    await expect(page.getByRole("heading", { name: "Aanmeldingen" })).toBeVisible();
    await expect(page.getByText(noorName)).toBeVisible();
    // The other group of the organization shows only its name, with the eye button.
    await expect(page.getByText(other.name)).toBeVisible();
    await expect(page.getByRole("button", { name: "Toon met je toegangssleutel" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await noor.close();
    await adminContext.close();
  }
});
