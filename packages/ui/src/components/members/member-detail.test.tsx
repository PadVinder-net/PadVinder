import { membersFixture, membersWithContactFixture } from "@padvinder/contracts/fixtures";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MemberDetail } from "./member-detail";

function setup(member = membersWithContactFixture[1]!, canRemove = true) {
  const onRemove = vi.fn();
  render(
    <MemberDetail
      member={member}
      workingGroupName="Noord"
      canRemove={canRemove}
      onRemove={onRemove}
      pending={false}
    />,
  );
  return onRemove;
}

test("shows contact rows with links for a member with contact", () => {
  setup(membersWithContactFixture[0]!);
  expect(screen.getByRole("heading", { name: "Anna de Vries" })).toBeVisible();
  expect(screen.getByRole("link", { name: "anna@example.test" })).toHaveAttribute(
    "href",
    "mailto:anna@example.test",
  );
  expect(screen.getByRole("link", { name: "06 12345678" })).toHaveAttribute(
    "href",
    "tel:0612345678",
  );
});

test("a member without a phone number says so", () => {
  setup();
  expect(screen.getByText("Geen telefoonnummer")).toBeVisible();
});

test("a member without contact fields shows no contact rows", () => {
  setup(membersFixture[1]!, false);
  expect(screen.queryByText("E-mailadres")).toBeNull();
  expect(screen.queryByText("Telefoonnummer")).toBeNull();
  expect(screen.queryByText("Geen telefoonnummer")).toBeNull();
});

test("no remove button without canRemove", () => {
  setup(membersFixture[1]!, false);
  expect(screen.queryByRole("button", { name: "Verwijder uit werkgroep" })).toBeNull();
});

test("removing asks first with the exact text and calls onRemove once", async () => {
  const onRemove = setup();
  await userEvent.click(screen.getByRole("button", { name: "Verwijder uit werkgroep" }));
  const dialog = screen.getByRole("alertdialog", { name: "Bram Jansen verwijderen uit Noord?" });
  expect(dialog).toHaveTextContent("Bram Jansen kan zich daarna opnieuw aanmelden.");
  expect(onRemove).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Verwijder" }));
  expect(onRemove).toHaveBeenCalledOnce();
});
