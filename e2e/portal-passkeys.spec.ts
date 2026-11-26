import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { runAdmin } from "./helpers/admin.ts";
import { newAddress, randomWord, readLoginCode, readMail } from "./helpers/mailpit.ts";
import { addVirtualAuthenticator } from "./helpers/passkeys.ts";
import { createSession } from "./helpers/session.ts";
import { createWorkingGroup } from "./helpers/working-groups.ts";

// Each page gets Chromium's virtual authenticator, which answers the browser's passkey prompt by
// itself. Passkeys work on http://localhost: the relying party ID is the host name of
// PUBLIC_ORIGIN, and the portal's origin is one of ALLOWED_ORIGINS.

function originOf(variable: "PORTAL_PORT"): string {
  const port = process.env[variable];
  if (!port) throw new Error(`${variable} is not set. Run scripts/setup-workspace.sh.`);
  return `http://localhost:${port}`;
}

/** A second person on a laptop: its own browser context on the portal, so its own session. */
async function newPortalPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    baseURL: originOf("PORTAL_PORT"),
  });
  return context.newPage();
}

/**
 * From the header, through Profiel, to Toegangssleutels, and makes the first passkey in the modal
 * that opens there: an admin without a confirmed session cannot list their passkeys yet.
 */
async function makeFirstPasskey(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "Profiel" }).click();
  await expect(page.getByRole("heading", { name: "Profiel", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Toegangssleutels" }).click();

  const modal = page.getByRole("dialog", { name: "Maak een toegangssleutel" });
  await expect(modal).toContainText("Voor beheer heb je een toegangssleutel nodig.");
  await modal.getByRole("button", { name: "Maak een toegangssleutel" }).click();
  await expect(modal).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "Toegangssleutels", level: 1 })).toBeVisible();
  const passkeys = page.getByRole("listitem").filter({ hasText: "Toegevoegd op" });
  await expect(passkeys).toHaveCount(1);
}

async function logOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Log uit" }).click();
  await expect(page.getByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
}

test("an organization admin makes a first passkey, logs out and logs in with it", async ({
  page,
}) => {
  const group = createWorkingGroup();
  await createSession(page.context(), group.adminAddress, { name: `Bram ${randomWord()}` });
  const authenticator = await addVirtualAuthenticator(page);
  try {
    await makeFirstPasskey(page);
    await expect(page.getByText("De toegangssleutel is toegevoegd.")).toBeVisible();
    await readMail(group.adminAddress, "Er is een toegangssleutel toegevoegd aan je account");

    await logOut(page);
    await page.getByRole("button", { name: "Log in met je toegangssleutel" }).click();
    // No code: the passkey alone logs in, and home goes to Werkgroepen.
    await expect(page).toHaveURL(/\/working-groups$/);
    await expect(
      page.getByRole("navigation", { name: "Beheer" }).getByRole("link", { name: "Werkgroepen" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Vul je code in" })).toHaveCount(0);
  } finally {
    await authenticator.remove();
  }
});

test("an admin with a passkey confirms on a code session", async ({ page }) => {
  const group = createWorkingGroup();
  await createSession(page.context(), group.adminAddress, { name: `Bram ${randomWord()}` });
  const authenticator = await addVirtualAuthenticator(page);
  try {
    await makeFirstPasskey(page);
    await logOut(page);

    // A session from a code is not confirmed, so the list asks for the passkey first.
    await page.getByLabel("E-mailadres").fill(group.adminAddress);
    await page.getByRole("button", { name: "Stuur code" }).click();
    await expect(page.getByRole("heading", { name: "Vul je code in" })).toBeVisible();
    // The first code was createSession's.
    await page.getByLabel("Code").fill(await readLoginCode(group.adminAddress, { count: 2 }));
    await expect(page).toHaveURL(/\/working-groups$/);

    await page.getByRole("link", { name: "Profiel" }).click();
    await page.getByRole("link", { name: "Toegangssleutels" }).click();
    const modal = page.getByRole("dialog", { name: "Bevestig dat jij het bent" });
    await expect(modal).toContainText("Voor beheer vraagt PadVinder om je toegangssleutel.");
    await modal.getByRole("button", { name: "Gebruik je toegangssleutel" }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Toegevoegd op" })).toHaveCount(1);
  } finally {
    await authenticator.remove();
  }
});

test("a platform admin repairs an organization admin who lost their passkey", async ({
  page,
  browser,
}) => {
  const group = createWorkingGroup();
  const adminName = `Bram ${randomWord()}`;

  // The organization admin makes a passkey on their own laptop.
  const adminPage = await newPortalPage(browser);
  try {
    await createSession(adminPage.context(), group.adminAddress, { name: adminName });
    const adminAuthenticator = await addVirtualAuthenticator(adminPage);
    await makeFirstPasskey(adminPage);
    await adminAuthenticator.remove();
  } finally {
    await adminPage.context().close();
  }

  // A platform admin makes their own passkey, which confirms their session for the reset.
  const platformAdmin = newAddress("hoofdbeheerder");
  runAdmin("grant-platform-admin", "--email", platformAdmin);
  await createSession(page.context(), platformAdmin, { name: `Hanna ${randomWord()}` });
  const authenticator = await addVirtualAuthenticator(page);
  try {
    await makeFirstPasskey(page);

    await page.goto(`/organizations/${group.organizationId}`);
    await expect(page.getByRole("heading", { name: group.organizationName })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: group.adminAddress });
    await expect(row).toContainText(adminName);
    await expect(row).not.toContainText("Nog geen toegangssleutel");

    await row.getByRole("button", { name: `Acties voor ${adminName}` }).click();
    await page.getByRole("menuitem", { name: "Verwijder toegangssleutels" }).click();
    const question = page.getByRole("alertdialog", {
      name: `Toegangssleutels van ${adminName} verwijderen?`,
    });
    await expect(question).toContainText(
      `Doe dit als ${adminName} geen toegangssleutel meer heeft`,
    );
    await question.getByRole("button", { name: "Verwijder" }).click();

    await expect(
      page.getByText(`De toegangssleutels van ${adminName} zijn verwijderd.`),
    ).toBeVisible();
    await expect(question).toHaveCount(0);
    await expect(row).toContainText("Nog geen toegangssleutel");
    await readMail(group.adminAddress, "Je toegangssleutels zijn verwijderd");
  } finally {
    await authenticator.remove();
  }
});
