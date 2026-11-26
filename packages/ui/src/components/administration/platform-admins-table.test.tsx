import { platformAdminsFixture } from "@padvinder/contracts/fixtures";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PlatformAdminsTable } from "./platform-admins-table";

test("the menu of a row calls onRemove with that platform admin", async () => {
  const onRemove = vi.fn();
  render(<PlatformAdminsTable admins={platformAdminsFixture} onRemove={onRemove} />);
  await userEvent.click(screen.getByRole("button", { name: "Acties voor Pieter Jansen" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Verwijder als hoofdbeheerder" }));
  expect(onRemove).toHaveBeenCalledWith(platformAdminsFixture[2]);
});

test("someone who never logged in shows (nog niet ingelogd), and the menu is named for the address", () => {
  render(<PlatformAdminsTable admins={platformAdminsFixture} onRemove={() => {}} />);
  expect(screen.getByText("(nog niet ingelogd)")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Acties voor nieuwe-hoofdbeheerder@example.test" }),
  ).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "E-mailadres" })).toBeVisible();
});
