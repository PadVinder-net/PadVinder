import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { runAdmin } from "./helpers/admin.ts";
import { newAddress, randomWord } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";
import { createWorkingGroup, makeVolunteer } from "./helpers/working-groups.ts";

// The dev database is shared by every run and worker, and audit entries are never removed: each
// test finds its own rows by the random name of its own person or working group, never by
// position in the whole log.

function originOf(variable: "MOBILE_PORT"): string {
  const port = process.env[variable];
  if (!port) throw new Error(`${variable} is not set. Run scripts/setup-workspace.sh.`);
  return `http://localhost:${port}`;
}

/** A second person on a phone: its own browser context on the app's origin. */
async function newPhonePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: originOf("MOBILE_PORT"),
  });
  return context.newPage();
}

/** A fresh platform admin, logged in in this page's context with a random name. */
async function logInAsPlatformAdmin(page: Page): Promise<string> {
  const address = newAddress("hoofdbeheerder");
  runAdmin("grant-platform-admin", "--email", address);
  const name = `Hanna ${randomWord()}`;
  await createSession(page.context(), address, { name });
  return name;
}

/** The rows of the audit log's table, without its header. */
function logRows(page: Page) {
  return page.getByRole("table").locator("tbody").getByRole("row");
}

async function chooseOption(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("a platform admin appoints a platform admin, reads it in the log and removes them", async ({
  page,
}) => {
  const adminName = await logInAsPlatformAdmin(page);
  const appointed = newAddress("nieuwe-hoofdbeheerder");
  const navigation = page.getByRole("navigation", { name: "Beheer" });

  await page.goto("/platform-admins");
  await page.getByRole("button", { name: "Voeg hoofdbeheerder toe" }).click();
  const dialog = page.getByRole("dialog", { name: "Hoofdbeheerder toevoegen" });
  // Capitals and spaces reach the same account: the second step shows the address as stored.
  await dialog.getByLabel("E-mailadres").fill(`  ${appointed.toUpperCase()} `);
  await dialog.getByRole("button", { name: "Ga verder" }).click();
  await expect(dialog).toContainText(`Je maakt ${appointed} hoofdbeheerder.`);
  await dialog.getByRole("button", { name: "Maak hoofdbeheerder" }).click();

  await expect(page.getByText(`${appointed} is hoofdbeheerder.`)).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: appointed });
  await expect(row).toContainText("(nog niet ingelogd)");

  await navigation.getByRole("link", { name: "Logboek" }).click();
  await expect(page.getByRole("heading", { name: "Logboek" })).toBeVisible();
  await chooseOption(page, "Actie", "Rollen");
  const entry = logRows(page)
    .filter({ hasText: adminName })
    .filter({ hasText: "Hoofdbeheerder gemaakt: (nog niet ingelogd)" });
  await expect(entry).toHaveCount(1);
  await expect(entry.getByRole("cell").nth(1)).toHaveText(adminName);
  await expect(entry.getByRole("cell").nth(2)).toHaveText(
    "Hoofdbeheerder gemaakt: (nog niet ingelogd)",
  );

  await navigation.getByRole("link", { name: "Hoofdbeheerders" }).click();
  await row.getByRole("button", { name: /^Acties voor / }).click();
  await page.getByRole("menuitem", { name: "Verwijder als hoofdbeheerder" }).click();
  // The appointed person never logged in, so has no name yet.
  const question = page.getByRole("alertdialog", {
    name: "Deze persoon verwijderen als hoofdbeheerder?",
  });
  await question.getByRole("button", { name: "Verwijder" }).click();
  await expect(page.getByText("Deze persoon is geen hoofdbeheerder meer.")).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("an organization admin reads the log of their own organization only", async ({ page }) => {
  const group = createWorkingGroup();
  const adminName = `Bram ${randomWord()}`;
  await createSession(page.context(), group.adminAddress, { name: adminName });

  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Beheer" });
  await navigation.getByRole("link", { name: "Logboek" }).click();
  await expect(page.getByRole("heading", { name: "Logboek" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Hoofdbeheerders" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Account verwijderen" })).toHaveCount(0);

  // Exactly the four entries the admin tool wrote for this organization, all by the tool.
  // `createOrganization` and `createWorkingGroup` each write two in one transaction.
  const rows = logRows(page);
  await expect(rows).toHaveCount(4);
  for (const sentence of [
    `Organisatie toegevoegd: ${group.organizationName}`,
    `Beheerder gemaakt: ${adminName} bij ${group.organizationName}`,
    `Werkgroep toegevoegd: ${group.name}`,
    `Coördinator gemaakt: (nog niet ingelogd) bij ${group.name}`,
  ]) {
    const row = rows.filter({ has: page.getByRole("cell", { name: sentence, exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("cell").nth(1)).toHaveText("Systeem");
  }

  // An admin of one organization gets no organization filter, and no species or accounts.
  await expect(page.getByRole("combobox", { name: "Organisatie" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Actie" }).click();
  await expect(page.getByRole("option")).toHaveText([
    "Alle acties",
    "Organisaties",
    "Werkgroepen",
    "Rollen",
    "Leden en aanmeldingen",
  ]);
  await expect(page.getByRole("option", { name: "Soorten" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  for (const path of ["/platform-admins", "/delete-account"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Deze pagina bestaat niet" })).toBeVisible();
  }
});

test("a platform admin deletes someone's account, and the only coordinator stays", async ({
  page,
  browser,
}) => {
  const group = createWorkingGroup();
  const volunteer = newAddress("vrijwilliger");
  const volunteerName = `Vera ${randomWord()}`;
  makeVolunteer(volunteer, group.id);

  const phone = await newPhonePage(browser);
  try {
    await createSession(phone.context(), volunteer, { name: volunteerName });
    await phone.goto("/app/more");
    await expect(phone.getByRole("link", { name: "Profiel" })).toBeVisible();

    await logInAsPlatformAdmin(page);
    await page.goto("/delete-account");
    const field = page.getByLabel("E-mailadres");
    const search = page.getByRole("button", { name: "Zoek" });

    // Only the whole address finds an account.
    await field.fill(volunteer.split("@")[0]!);
    await search.click();
    await expect(page.getByText("Vul een geldig e-mailadres in.")).toBeVisible();

    await field.fill(volunteer);
    await search.click();
    await expect(page.getByRole("heading", { name: volunteerName })).toBeVisible();
    await expect(page.getByText(`${group.name} · ${group.organizationName}`)).toBeVisible();

    await page.getByRole("button", { name: "Verwijder account" }).click();
    const question = page.getByRole("alertdialog", {
      name: `Account van ${volunteerName} verwijderen?`,
    });
    await expect(question).toContainText("Dit kun je niet terugdraaien.");
    await question.getByRole("button", { name: "Verwijder account" }).click();
    await expect(page.getByText(`Het account van ${volunteerName} is verwijderd.`)).toBeVisible();

    await field.fill(volunteer);
    await search.click();
    await expect(page.getByText("Geen account met dit adres.")).toBeVisible();

    // The deletion ends the volunteer's session and event stream: the browser reconnects after
    // the stream's retry of 5 seconds, gets a 401, and the app shows the login screen.
    await expect(phone.getByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible({
      timeout: 15_000,
    });

    // The group's only coordinator never logged in, so the question names them by address.
    await field.fill(group.coordinatorAddress);
    await search.click();
    await expect(page.getByRole("heading", { name: "(nog niet ingelogd)" })).toBeVisible();
    await page.getByRole("button", { name: "Verwijder account" }).click();
    const blocked = page.getByRole("alertdialog", {
      name: `Account van ${group.coordinatorAddress} verwijderen?`,
    });
    await blocked.getByRole("button", { name: "Verwijder account" }).click();
    await expect(blocked).toContainText(
      `${group.coordinatorAddress} is de enige coördinator van ${group.name}. Maak eerst iemand anders coördinator.`,
    );
    await blocked.getByRole("button", { name: "Annuleer" }).click();

    await search.click();
    await expect(page.getByRole("heading", { name: "(nog niet ingelogd)" })).toBeVisible();
    await expect(
      page.getByText(`${group.name} · ${group.organizationName} (coördinator)`),
    ).toBeVisible();
  } finally {
    await phone.context().close();
  }
});
