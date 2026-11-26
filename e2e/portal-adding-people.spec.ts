import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { runAdmin } from "./helpers/admin.ts";
import { newAddress, randomWord, readLoginCode, readMail } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";
import { createWorkingGroup, makeVolunteer } from "./helpers/working-groups.ts";

// Organizations and working groups cannot be deleted, so every run leaves its own behind in the
// dev database, named with random letters. The mails about adding go through the queue: the
// worker under `pnpm dev` sends them to Mailpit, and `readMail` waits for them.

function mobileOrigin(): string {
  const port = process.env.MOBILE_PORT;
  if (!port) throw new Error("MOBILE_PORT is not set. Run scripts/setup-workspace.sh.");
  return `http://localhost:${port}`;
}

/** A second person on a phone: its own browser context on the app's origin. */
async function newPhonePage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: mobileOrigin() });
  return context.newPage();
}

/** The member's row in Leden. Rows are found by address: people who never logged in share a name. */
function memberRow(page: Page, address: string) {
  return page.getByRole("row").filter({ hasText: address });
}

/** Opens "Voeg mensen toe" and fills the field with `lines`, one per line. */
async function fillAddMembers(page: Page, lines: string[]) {
  await page.getByRole("button", { name: "Voeg mensen toe" }).click();
  const dialog = page.getByRole("dialog", { name: "Mensen toevoegen" });
  await dialog.getByLabel("E-mailadressen").fill(lines.join("\n"));
  return dialog;
}

test("a platform admin makes an organization and a group and adds two people with a pasted list", async ({
  page,
  browser,
}) => {
  const platformAdmin = newAddress("hoofdbeheerder");
  runAdmin("grant-platform-admin", "--email", platformAdmin);
  await createSession(page.context(), platformAdmin, { name: "Hanna Hoofd" });

  const word = randomWord();
  const organizationName = `Paddentrek ${word}`;
  await page.goto("/organizations");
  await page.getByRole("button", { name: "Nieuwe organisatie" }).click();
  const organizationForm = page.getByRole("dialog");
  await organizationForm.getByLabel("Naam", { exact: true }).fill(organizationName);
  await organizationForm.getByLabel("E-mailadres van de beheerder").fill(newAddress("beheerder"));
  await organizationForm.getByRole("button", { name: "Bewaar" }).click();
  await expect(page.getByRole("heading", { name: organizationName })).toBeVisible();

  // The platform admin leaves their own address as the first coordinator.
  const groupName = `Groep ${word}`;
  await page.getByRole("button", { name: "Nieuwe werkgroep" }).click();
  const groupForm = page.getByRole("dialog");
  await groupForm.getByLabel("Naam", { exact: true }).fill(groupName);
  await groupForm.getByLabel("Plaats", { exact: true }).fill(`Plaats ${word}`);
  await groupForm.getByRole("button", { name: "Bewaar" }).click();
  await expect(page.getByRole("heading", { name: groupName })).toBeVisible();

  const first = newAddress("eerste");
  const second = newAddress("tweede");
  const dialog = await fillAddMembers(page, [first, second, "geen adres"]);
  await expect(dialog.getByText("Regel 3: 'geen adres' is geen geldig e-mailadres.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Voeg toe" })).toBeDisabled();

  await dialog.getByLabel("E-mailadressen").fill(`${first}\n${second}`);
  await dialog.getByRole("button", { name: "Voeg toe" }).click();
  await expect(dialog.getByText(`${first} is toegevoegd.`)).toBeVisible();
  await expect(dialog.getByText(`${second} is toegevoegd.`)).toBeVisible();
  await dialog.getByRole("button", { name: "Sluit", exact: true }).click();

  await expect(memberRow(page, first)).toContainText("(nog niet ingelogd)");
  await expect(memberRow(page, second)).toContainText("(nog niet ingelogd)");

  const mail = await readMail(first, `Je bent toegevoegd aan werkgroep ${groupName}`);
  expect(mail.text).toContain(`Hanna Hoofd heeft je toegevoegd aan werkgroep ${groupName}`);
  const link = /https?:\/\/\S+\/app\//.exec(mail.text)?.[0];
  if (!link) throw new Error(`No link to the app in:\n${mail.text}`);
  expect(link).toBe(`${process.env.PUBLIC_ORIGIN ?? mobileOrigin()}/app/`);

  // The first person opens the link on their phone and logs in for the first time.
  const phone = await newPhonePage(browser);
  try {
    await phone.goto(link);
    await phone.getByLabel("E-mailadres").fill(first);
    await phone.getByRole("button", { name: "Stuur code" }).click();
    await phone.getByLabel("Code").fill(await readLoginCode(first));
    await phone.getByLabel("Naam").fill("Eva Eerste");
    await phone.getByRole("button", { name: "Ga verder" }).click();

    // A member already: the tabs, not the picker.
    await expect(phone.getByRole("link", { name: "Meer" })).toBeVisible();
    await expect(phone.getByRole("heading", { name: "Kies je werkgroep" })).toHaveCount(0);
  } finally {
    await phone.context().close();
  }

  // Leden follows: the first person has a name now.
  await page.reload();
  await expect(memberRow(page, first)).toContainText("Eva Eerste");
});

test("someone who has an account gets an invitation instead, and asks for the group in the app", async ({
  page,
  browser,
}) => {
  const group = createWorkingGroup();
  const elsewhere = createWorkingGroup();
  const volunteer = newAddress("vrijwilliger");
  makeVolunteer(volunteer, elsewhere.id);
  await createSession(page.context(), group.coordinatorAddress, { name: "Carla Jansen" });

  const phone = await newPhonePage(browser);
  try {
    await createSession(phone.context(), volunteer, { name: "Vera Vrijwilliger" });

    await page.goto(`/working-groups/${group.id}`);
    await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
    let dialog = await fillAddMembers(page, [volunteer]);
    await dialog.getByRole("button", { name: "Voeg toe" }).click();
    await expect(
      dialog.getByText(`${volunteer} heeft al een account en krijgt een mail.`),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Sluit", exact: true }).click();
    // Not added: the coordinator sees no row and no name of them.
    await expect(memberRow(page, volunteer)).toHaveCount(0);

    const mail = await readMail(volunteer, "wil je toevoegen aan werkgroep");
    expect(mail.subject.endsWith(`wil je toevoegen aan werkgroep ${group.name}`)).toBe(true);

    await phone.goto("/app/more");
    await phone.getByRole("link", { name: "Profiel" }).click();
    await phone.getByRole("button", { name: "Meld je aan bij nog een werkgroep" }).click();
    await phone.getByLabel("Zoek op werkgroep, organisatie of plaats").fill(group.name);
    await phone.getByText(group.name, { exact: true }).click();
    await phone.getByRole("button", { name: "Meld je aan" }).click();
    await expect(
      phone.getByText(`Je aanmelding bij ${group.name} wacht op goedkeuring.`),
    ).toBeVisible();

    // Their own pending request turns the adding into an approval.
    dialog = await fillAddMembers(page, [volunteer]);
    await dialog.getByRole("button", { name: "Voeg toe" }).click();
    await expect(dialog.getByText(`${volunteer} is toegelaten.`)).toBeVisible();
    await dialog.getByRole("button", { name: "Sluit", exact: true }).click();
    await expect(memberRow(page, volunteer)).toContainText("Vera Vrijwilliger");

    // The live event updates Profiel without a reload.
    await expect(phone.getByText(`${group.name},`)).toBeVisible();
    await expect(phone.getByText(`${elsewhere.name},`)).toBeVisible();
    await expect(phone.getByText(/wacht op goedkeuring/)).toHaveCount(0);
  } finally {
    await phone.context().close();
  }
});
