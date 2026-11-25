import { expect, test } from "@playwright/test";
import { newAddress, readLoginCode } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";
import { createWorkingGroup, makeVolunteer } from "./helpers/working-groups.ts";

test("a member deletes their account and starts over with the same address", async ({
  page,
  context,
}) => {
  const group = createWorkingGroup();
  const address = newAddress("delete");
  makeVolunteer(address, group.id);
  await createSession(context, address, { name: "Daan de Vries" });

  await page.goto("/app/more");
  await page.getByRole("link", { name: "Profiel" }).click();
  await page.getByRole("button", { name: "Verwijder account" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Account verwijderen?" });
  await dialog.getByRole("button", { name: "Verwijder account" }).click();

  await expect(page.getByRole("heading", { name: "Log in bij PadVinder" })).toBeVisible();
  await expect(page.getByText("Je account is verwijderd.")).toBeVisible();

  // The same address makes a fresh account: it has no name and no working group.
  await page.getByLabel("E-mailadres").fill(address);
  await page.getByRole("button", { name: "Stuur code" }).click();
  // The first login code went to this address when the session was made.
  await page.getByLabel("Code").fill(await readLoginCode(address, { count: 2 }));
  await expect(page.getByRole("heading", { name: "Hoe heet je?" })).toBeVisible();
  await page.getByLabel("Naam").fill("Daan de Vries");
  await page.getByRole("button", { name: "Ga verder" }).click();
  await expect(page.getByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
});

test("the only coordinator cannot delete their account in the app", async ({ page, context }) => {
  // The group's first coordinator is its only one, and the organization has no contact address.
  const group = createWorkingGroup();
  await createSession(context, group.coordinatorAddress, { name: "Carla Coördinator" });

  await page.goto("/app/more");
  await page.getByRole("link", { name: "Profiel" }).click();
  await page.getByRole("button", { name: "Verwijder account" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Account verwijderen?" });
  await dialog.getByRole("button", { name: "Verwijder account" }).click();

  await expect(dialog).toContainText(
    `Je bent de enige coördinator van ${group.name}. Vraag de beheerder van `,
  );
  await expect(dialog).toContainText("om eerst iemand anders coördinator te maken.");

  // The account stays: closing the question shows the profile, not the login screen.
  await dialog.getByRole("button", { name: "Annuleer" }).click();
  await expect(page.getByRole("heading", { name: "Profiel" })).toBeVisible();
  await expect(page.getByLabel("Naam")).toHaveValue("Carla Coördinator");
  await expect(page.getByRole("heading", { name: "Log in bij PadVinder" })).toHaveCount(0);
});
