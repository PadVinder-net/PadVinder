import { accountSummaryFixture, accountWithoutGroupsFixture } from "@padvinder/contracts/fixtures";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { apiErrorMessage } from "../../lib/messages";
import { AccountSummaryCard } from "./account-summary-card";

test("the card lists the working groups with their organization and marks a coordinator", () => {
  render(
    <AccountSummaryCard
      account={{
        ...accountSummaryFixture,
        isPlatformAdmin: true,
        organizationAdminOf: [{ id: "o1", name: "Fictiefdorp" }],
      }}
      own={false}
      onDelete={() => {}}
    />,
  );
  expect(screen.getByRole("heading", { name: "Sanne Bakker" })).toBeVisible();
  expect(screen.getByText("sanne@example.test")).toBeVisible();
  expect(screen.getByText("Hoofdbeheerder")).toBeVisible();
  expect(screen.getByText("Beheerder van Fictiefdorp")).toBeVisible();
  expect(screen.getByText("Noord · Paddentrek Voorbeeldstad (coördinator)")).toBeVisible();
  expect(screen.getByText("Zuid · Paddentrek Voorbeeldstad")).toBeVisible();
  expect(screen.getByRole("button", { name: "Verwijder account" })).toBeVisible();
});

test("an account without working groups shows Geen werkgroepen. and can still be deleted", async () => {
  const onDelete = vi.fn();
  render(
    <AccountSummaryCard account={accountWithoutGroupsFixture} own={false} onDelete={onDelete} />,
  );
  expect(screen.getByRole("heading", { name: "(nog niet ingelogd)" })).toBeVisible();
  expect(screen.getByText("Geen werkgroepen.")).toBeVisible();
  expect(screen.queryByText("Hoofdbeheerder")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Verwijder account" }));
  expect(onDelete).toHaveBeenCalledOnce();
});

test("the own account shows the text and no button", () => {
  render(<AccountSummaryCard account={accountSummaryFixture} own onDelete={() => {}} />);
  expect(screen.getByText(apiErrorMessage("own_account"))).toBeVisible();
  expect(screen.queryByRole("button", { name: "Verwijder account" })).toBeNull();
});

test("markup in a name is shown as text", () => {
  render(
    <AccountSummaryCard
      account={{ ...accountSummaryFixture, name: "<b>Sanne</b>" }}
      own={false}
      onDelete={() => {}}
    />,
  );
  expect(screen.getByRole("heading", { name: "<b>Sanne</b>" })).toBeVisible();
  expect(document.querySelector("b")).toBeNull();
});
