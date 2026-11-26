import { devices, expect, test as base, type Page } from "@playwright/test";
import { join, requestLinkFromMail } from "./helpers/joining.ts";
import { newAddress, readLoginCode, readMail } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";
import { addWorkingGroup, createWorkingGroup, makeCoordinator } from "./helpers/working-groups.ts";

// A second phone next to `page`: its own browser context, so its own session.
const test = base.extend<{ secondPhone: Page }>({
  secondPhone: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ ...devices["Pixel 7"], baseURL });
    await use(await context.newPage());
    await context.close();
  },
});

test("a volunteer joins and the coordinator approves", async ({ page, secondPhone }) => {
  const group = createWorkingGroup();
  const carla = newAddress("carla");
  const noor = newAddress("noor");
  makeCoordinator(carla, group.id);
  await createSession(secondPhone.context(), carla, { name: "Carla Jansen" });
  await createSession(page.context(), noor, { name: "Noor de Vries" });

  await page.goto("/app/");
  await join(page, group.name);

  const link = await requestLinkFromMail(carla, group.name);
  await secondPhone.goto(link);
  await expect(secondPhone.getByRole("heading", { name: "Noor de Vries" })).toBeVisible();
  await secondPhone.getByRole("button", { name: "Keur goed" }).click();
  await expect(secondPhone.getByText("Noor de Vries is toegelaten.")).toBeVisible();

  // The live event turns the waiting screen into the tabs, without a reload.
  await expect(page.getByRole("link", { name: "Meer" })).toBeVisible();
  await readMail(noor, `Je bent toegelaten tot werkgroep ${group.name}`);

  await page.getByRole("link", { name: "Meer" }).click();
  await page.getByRole("link", { name: "Leden" }).click();
  const carlaRow = page.getByRole("listitem").filter({ hasText: "Carla Jansen" });
  await expect(carlaRow).toContainText("coördinator");
  await expect(page.getByRole("listitem").filter({ hasText: "Noor de Vries" })).toBeVisible();
});

test("a rejected volunteer can choose again", async ({ page, secondPhone }) => {
  const group = createWorkingGroup();
  const carla = newAddress("carla");
  const noor = newAddress("noor");
  makeCoordinator(carla, group.id);
  await createSession(secondPhone.context(), carla, { name: "Carla Jansen" });
  await createSession(page.context(), noor, { name: "Noor de Vries" });

  await page.goto("/app/");
  await join(page, group.name);

  await secondPhone.goto("/app/more");
  await secondPhone.getByRole("link", { name: /^Aanmeldingen/ }).click();
  await secondPhone.getByRole("button", { name: /Noor de Vries/ }).click();
  await secondPhone.getByRole("button", { name: "Wijs af" }).click();
  const dialog = secondPhone.getByRole("alertdialog", { name: "Aanmelding afwijzen?" });
  await dialog.getByRole("button", { name: "Wijs af" }).click();
  await expect(secondPhone.getByText("De aanmelding is afgewezen.")).toBeVisible();

  // Without a reload, the picker returns with the notice above it.
  await expect(
    page.getByText(
      `Je aanmelding bij ${group.name} is niet goedgekeurd. Je kunt een andere werkgroep kiezen.`,
    ),
  ).toBeVisible();
  await readMail(noor, `Je aanmelding bij werkgroep ${group.name}`);

  // A rejected applicant may ask again, also for the same group.
  await join(page, group.name);
});

test("the link from the mail survives the login screen", async ({ page, secondPhone }) => {
  const group = createWorkingGroup();
  const carla = newAddress("carla");
  makeCoordinator(carla, group.id);
  await createSession(secondPhone.context(), newAddress("noor"), { name: "Noor de Vries" });
  await secondPhone.goto("/app/");
  await join(secondPhone, group.name);

  // Carla has no session in `page`, and the admin tool gave her account no name yet.
  await page.goto(await requestLinkFromMail(carla, group.name));
  await page.getByLabel("E-mailadres").fill(carla);
  await page.getByRole("button", { name: "Stuur code" }).click();
  await page.getByLabel("Code").fill(await readLoginCode(carla));
  await page.getByLabel("Naam").fill("Carla Jansen");
  await page.getByRole("button", { name: "Ga verder" }).click();

  await expect(page).toHaveURL(/\/app\/more\/membership-requests\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Noor de Vries" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keur goed" })).toBeVisible();
});

test("a volunteer withdraws and chooses another group", async ({ page }) => {
  const first = createWorkingGroup();
  const second = addWorkingGroup(first.organizationId);
  await createSession(page.context(), newAddress("noor"), { name: "Noor de Vries" });

  await page.goto("/app/");
  await join(page, first.name);

  await page.getByRole("button", { name: "Trek aanmelding in" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Aanmelding intrekken?" });
  await dialog.getByRole("button", { name: "Trek aanmelding in" }).click();

  await join(page, second.name);
});
