import { expect, type Page } from "@playwright/test";
import { readMail } from "./mailpit.ts";

/** On the app's picker: filters on the group's name, chooses it and asks to join. */
export async function join(page: Page, workingGroupName: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "Kies je werkgroep" })).toBeVisible();
  await page.getByLabel("Zoek op werkgroep, organisatie of plaats").fill(workingGroupName);
  await page.getByText(workingGroupName, { exact: true }).click();
  await page.getByRole("button", { name: "Meld je aan" }).click();
  await expect(page.getByRole("heading", { name: "Welkom!" })).toBeVisible();
  await expect(
    page.getByText(`De coördinator van ${workingGroupName} neemt contact`),
  ).toBeVisible();
}

/** The link to the request in the coordinator's mail: `{origin}/app/more/membership-requests/{id}`. */
export async function requestLinkFromMail(
  address: string,
  workingGroupName: string,
): Promise<string> {
  const mail = await readMail(address, `Nieuwe aanmelding bij ${workingGroupName}`);
  const link = /https?:\/\/\S+\/app\/more\/membership-requests\/[0-9a-f-]+/.exec(mail.text)?.[0];
  if (!link) throw new Error(`No link to the request in:\n${mail.text}`);
  return link;
}
