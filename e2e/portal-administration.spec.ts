import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { runAdmin } from "./helpers/admin.ts";
import { newAddress, randomWord } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";
import { createWorkingGroup, makeVolunteer } from "./helpers/working-groups.ts";

// Organizations and working groups cannot be deleted, so every run leaves its own behind in the
// dev database, named with random letters.

function originOf(variable: "MOBILE_PORT" | "PORTAL_PORT"): string {
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

/** A second person on a phone: its own browser context on the app's origin. */
async function newPhonePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: originOf("MOBILE_PORT"),
  });
  return context.newPage();
}

/** The member's row in Leden. Rows are found by address: people who never logged in share a name. */
function memberRow(page: Page, address: string) {
  return page.getByRole("row").filter({ hasText: address });
}

/** Opens the row's menu and chooses `action`. */
async function chooseInRowMenu(page: Page, address: string, action: string): Promise<void> {
  await memberRow(page, address)
    .getByRole("button", { name: /^Acties voor / })
    .click();
  await page.getByRole("menuitem", { name: action }).click();
}

test("a platform admin makes an organization, and its admin makes a working group", async ({
  page,
  browser,
}) => {
  const platformAdmin = newAddress("hoofdbeheerder");
  runAdmin("grant-platform-admin", "--email", platformAdmin);
  await createSession(page.context(), platformAdmin);

  const word = randomWord();
  const organizationName = `Paddentrek ${word}`;
  const adminAddress = newAddress("beheerder");
  await page.goto("/organizations");
  await page.getByRole("button", { name: "Nieuwe organisatie" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Naam", { exact: true }).fill(organizationName);
  await form.getByLabel("E-mailadres van de beheerder").fill(adminAddress);
  await form.getByRole("button", { name: "Bewaar" }).click();

  await expect(page.getByText(`Organisatie ${organizationName} is toegevoegd.`)).toBeVisible();
  await expect(page.getByRole("heading", { name: organizationName })).toBeVisible();
  // The admin has never logged in: the tool made the account, without a name.
  await expect(page.getByRole("row").filter({ hasText: adminAddress })).toContainText(
    "(nog niet ingelogd)",
  );

  const adminPage = await newPortalPage(browser);
  try {
    await createSession(adminPage.context(), adminAddress, { name: "Bram Beheer" });
    await adminPage.goto("/");
    // Home sends someone who manages something to the first item, Werkgroepen.
    await expect(adminPage).toHaveURL(/\/working-groups$/);
    const navigation = adminPage.getByRole("navigation", { name: "Beheer" });
    await expect(navigation.getByRole("link", { name: "Werkgroepen" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Organisatie", exact: true })).toBeVisible();

    const groupName = `Groep ${word}`;
    await adminPage.getByRole("button", { name: "Nieuwe werkgroep" }).click();
    const groupForm = adminPage.getByRole("dialog");
    await groupForm.getByLabel("Naam", { exact: true }).fill(groupName);
    await groupForm.getByLabel("Plaats", { exact: true }).fill(`Plaats ${word}`);
    // The admin's own address is filled in as the first coordinator; they leave it.
    await expect(groupForm.getByLabel("E-mailadres van de coördinator")).toHaveValue(adminAddress);
    await groupForm.getByRole("button", { name: "Bewaar" }).click();

    await expect(adminPage.getByText(`Werkgroep ${groupName} is toegevoegd.`)).toBeVisible();
    await expect(adminPage).toHaveURL(/\/working-groups\/[0-9a-f-]+$/);
    await expect(adminPage.getByRole("heading", { name: groupName })).toBeVisible();
    const ownRow = memberRow(adminPage, adminAddress);
    await expect(ownRow).toContainText("Bram Beheer");
    await expect(ownRow).toContainText("Coördinator");
  } finally {
    await adminPage.context().close();
  }
});

test("an admin makes a member coordinator, and the last coordinator cannot go", async ({
  page,
  context,
}) => {
  const group = createWorkingGroup();
  const volunteer = newAddress("vrijwilliger");
  makeVolunteer(volunteer, group.id);
  await createSession(context, group.adminAddress, { name: "Bram Beheer" });

  await page.goto(`/working-groups/${group.id}`);
  await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
  await expect(memberRow(page, group.coordinatorAddress)).toContainText("Coördinator");
  await expect(memberRow(page, volunteer)).not.toContainText("Coördinator");

  // Neither has logged in, so neither has a name: "Deze persoon" in the toasts.
  await chooseInRowMenu(page, volunteer, "Maak coördinator");
  await expect(page.getByText(`Deze persoon is nu coördinator van ${group.name}.`)).toBeVisible();
  await expect(memberRow(page, volunteer)).toContainText("Coördinator");

  await chooseInRowMenu(page, group.coordinatorAddress, "Niet langer coördinator");
  await expect(
    page.getByText(`Deze persoon is geen coördinator meer van ${group.name}.`),
  ).toBeVisible();
  await expect(memberRow(page, group.coordinatorAddress)).not.toContainText("Coördinator");

  await chooseInRowMenu(page, volunteer, "Niet langer coördinator");
  await expect(
    page.getByText(
      "Een werkgroep heeft altijd een coördinator. Maak eerst iemand anders coördinator.",
    ),
  ).toBeVisible();
  await expect(memberRow(page, volunteer)).toContainText("Coördinator");
});

test("a working group that is switched off leaves its member's app, and comes back", async ({
  page,
  context,
  browser,
}) => {
  const group = createWorkingGroup();
  const volunteer = newAddress("vrijwilliger");
  makeVolunteer(volunteer, group.id);
  await createSession(context, group.adminAddress, { name: "Bram Beheer" });

  const phone = await newPhonePage(browser);
  try {
    await createSession(phone.context(), volunteer, { name: "Vera Vrijwilliger" });
    await phone.goto("/app/more");
    await expect(phone.getByRole("link", { name: "Profiel" })).toBeVisible();

    await page.goto(`/working-groups/${group.id}`);
    await page.getByRole("button", { name: "Zet uit" }).click();
    const question = page.getByRole("alertdialog", { name: `Werkgroep ${group.name} uitzetten?` });
    await question.getByRole("button", { name: "Zet uit" }).click();
    await expect(page.getByText(`Werkgroep ${group.name} staat uit.`)).toBeVisible();
    await expect(page.getByText("Deze werkgroep staat uit.")).toBeVisible();

    // The live event takes the group out of the app, without a reload.
    await expect(phone.getByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();

    await page.getByRole("button", { name: "Zet aan" }).click();
    await expect(page.getByText(`Werkgroep ${group.name} staat aan.`)).toBeVisible();

    await expect(phone.getByRole("link", { name: "Meer" })).toBeVisible();
    await expect(phone.getByRole("heading", { name: "Kies je werkgroep" })).toHaveCount(0);
  } finally {
    await phone.context().close();
  }
});
