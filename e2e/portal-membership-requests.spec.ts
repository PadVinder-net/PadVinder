import { devices, expect, test as base, type Page } from "@playwright/test";
import { join, requestLinkFromMail } from "./helpers/joining.ts";
import { newAddress, readLoginCode } from "./helpers/mailpit.ts";
import { createSession } from "./helpers/session.ts";
import { createWorkingGroup, type TestWorkingGroup } from "./helpers/working-groups.ts";

// The link in the coordinator's request mail is the app's address for the request. On a laptop the
// app sends it on to the portal's requests page, with the request in a modal; on a phone the portal
// sends it back to the app. Both happen before the login. Every test makes its own organization and
// group, so the coordinator's list holds only the request the test made.

function originOf(variable: "MOBILE_PORT" | "PORTAL_PORT"): string {
  const port = process.env[variable];
  if (!port) throw new Error(`${variable} is not set. Run scripts/setup-workspace.sh.`);
  return `http://localhost:${port}`;
}

/** Escapes `text` for use in a regular expression. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `phone()` opens another person on a phone: its own browser context on the app's origin, so its
// own session. The contexts close after the test.
const test = base.extend<{ phone: () => Promise<Page> }>({
  phone: async ({ browser }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async () => {
      const context = await browser.newContext({
        ...devices["Pixel 7"],
        baseURL: originOf("MOBILE_PORT"),
      });
      contexts.push(context);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },
});

/**
 * Noor asks for the group in the app, on her own phone. Returns the link from the mail to the
 * group's first coordinator and the request's ID.
 */
async function noorAsksToJoin(
  phone: () => Promise<Page>,
  group: TestWorkingGroup,
): Promise<{ link: string; requestId: string }> {
  const applicant = await phone();
  await createSession(applicant.context(), newAddress("noor"), { name: "Noor de Vries" });
  await applicant.goto("/app/");
  await join(applicant, group.name);
  const link = await requestLinkFromMail(group.coordinatorAddress, group.name);
  return { link, requestId: link.split("/").at(-1)! };
}

/** The request's status, read through the API as the person logged in on `page`. */
async function requestStatus(page: Page, requestId: string): Promise<string> {
  const response = await page.request.get(
    `${originOf("PORTAL_PORT")}/api/membership-requests/${requestId}`,
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { status: string }).status;
}

test("the link from the request mail opens the portal's modal on a laptop, and deciding takes a button", async ({
  page,
  phone,
}) => {
  const group = createWorkingGroup();
  const { link, requestId } = await noorAsksToJoin(phone, group);

  // Not logged in: the app sends the laptop on to the portal before its login screen.
  await page.goto(link);
  await expect(page).toHaveURL(
    new RegExp(`^${literal(originOf("PORTAL_PORT"))}/membership-requests\\?request=${requestId}$`),
  );
  const coordinator = group.coordinatorAddress;
  await page.getByLabel("E-mailadres").fill(coordinator);
  await page.getByRole("button", { name: "Stuur code" }).click();
  await page.getByLabel("Code").fill(await readLoginCode(coordinator));
  // The admin tool made the coordinator's account, without a name.
  await page.getByLabel("Naam").fill("Carla Jansen");
  await page.getByRole("button", { name: "Ga verder" }).click();

  // After the login the address still names the request, and the modal shows it.
  const modal = page.getByRole("dialog", { name: "Noor de Vries" });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("button", { name: "Keur goed" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Wijs af" })).toBeVisible();
  // Opening it decided nothing.
  expect(await requestStatus(page, requestId)).toBe("pending");

  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(page).toHaveURL(/\/membership-requests$/);
  expect(await requestStatus(page, requestId)).toBe("pending");

  await page.getByRole("button", { name: "Noor de Vries" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?request=${requestId}$`));
  await modal.getByRole("button", { name: "Keur goed" }).click();
  await expect(page.getByText(`Noor de Vries is toegelaten tot ${group.name}.`)).toBeVisible();
  await expect(modal).toBeHidden();
  await expect(page.getByText("Er zijn geen open aanmeldingen.")).toBeVisible();
  expect(await requestStatus(page, requestId)).toBe("approved");
});

test("the same link stays in the app on a phone", async ({ phone }) => {
  const group = createWorkingGroup();
  const { link } = await noorAsksToJoin(phone, group);

  const coordinator = await phone();
  await createSession(coordinator.context(), group.coordinatorAddress, { name: "Carla Jansen" });
  await coordinator.goto(link);

  await expect(coordinator.getByRole("heading", { name: "Noor de Vries" })).toBeVisible();
  await expect(coordinator.getByRole("button", { name: "Keur goed" })).toBeVisible();
  await expect(coordinator.getByRole("button", { name: "Wijs af" })).toBeVisible();
  await expect(coordinator).toHaveURL(link);
});

test("the portal's requests page sends a phone to the app", async ({ phone }) => {
  const group = createWorkingGroup();
  const { requestId } = await noorAsksToJoin(phone, group);
  const appRequests = `${originOf("MOBILE_PORT")}/app/more/membership-requests`;

  const coordinator = await phone();
  await createSession(coordinator.context(), group.coordinatorAddress, { name: "Carla Jansen" });
  await coordinator.goto(`${originOf("PORTAL_PORT")}/membership-requests?request=${requestId}`);

  await expect(coordinator).toHaveURL(`${appRequests}/${requestId}`);
  await expect(coordinator.getByRole("heading", { name: "Noor de Vries" })).toBeVisible();
  await expect(coordinator.getByRole("button", { name: "Keur goed" })).toBeVisible();

  // The list without a request goes to the app's list.
  await coordinator.goto(`${originOf("PORTAL_PORT")}/membership-requests`);
  await expect(coordinator).toHaveURL(appRequests);
  await expect(coordinator.getByRole("button", { name: /Noor de Vries/ })).toBeVisible();
});
