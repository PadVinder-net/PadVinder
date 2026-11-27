import {
  managedWorkingGroupsFixture,
  membersWithContactFixture,
  organizationDetailFixture,
  organizationsFixture,
} from "@padvinder/contracts/fixtures";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MembersTable } from "./members-table";
import { OrganizationAdminsTable } from "./organization-admins-table";
import { OrganizationTable } from "./organization-table";
import { WorkingGroupTable } from "./working-group-table";

const noop = () => {};
const memberProps = {
  canSetCoordinator: true,
  canRemove: () => true,
  onSetCoordinator: noop,
  onRemove: noop,
};

function rowOf(text: string) {
  return screen.getByText(text).closest("tr")!;
}

test("the organization column shows only when the rows have more than one organization", () => {
  const { unmount } = render(
    <WorkingGroupTable workingGroups={managedWorkingGroupsFixture} onOpen={noop} />,
  );
  expect(screen.getByRole("columnheader", { name: "Organisatie" })).toBeVisible();
  unmount();
  render(
    <WorkingGroupTable workingGroups={managedWorkingGroupsFixture.slice(0, 2)} onOpen={noop} />,
  );
  expect(screen.queryByRole("columnheader", { name: "Organisatie" })).toBeNull();
  expect(screen.getByRole("columnheader", { name: "Aanmeldingen" })).toBeVisible();
});

test("a group that is off shows nee and has muted text; the name opens it", async () => {
  const onOpen = vi.fn();
  render(<WorkingGroupTable workingGroups={managedWorkingGroupsFixture} onOpen={onOpen} />);
  const off = rowOf("Buitengebied");
  expect(off).toHaveClass("text-muted-foreground");
  expect(within(off).getByText("nee")).toBeVisible();
  expect(rowOf("Noord")).not.toHaveClass("text-muted-foreground");
  await userEvent.click(screen.getByRole("button", { name: "Noord" }));
  expect(onOpen).toHaveBeenCalledWith(managedWorkingGroupsFixture[0]!.id);
});

test("working groups with no rows say so", () => {
  render(<WorkingGroupTable workingGroups={[]} onOpen={noop} />);
  expect(screen.getByText("Er zijn nog geen werkgroepen.")).toBeVisible();
});

test("a coordinator's row shows Coördinator and offers Niet langer coördinator", async () => {
  const onSetCoordinator = vi.fn();
  render(
    <MembersTable
      members={membersWithContactFixture}
      {...memberProps}
      onSetCoordinator={onSetCoordinator}
    />,
  );
  expect(within(rowOf("Anna de Vries")).getByText("Coördinator")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Acties voor Anna de Vries" }));
  expect(screen.queryByRole("menuitem", { name: "Maak coördinator" })).toBeNull();
  await userEvent.click(screen.getByRole("menuitem", { name: "Niet langer coördinator" }));
  expect(onSetCoordinator).toHaveBeenCalledWith(membersWithContactFixture[0], false);
});

test("a volunteer's row offers Maak coördinator, which calls onSetCoordinator(member, true)", async () => {
  const onSetCoordinator = vi.fn();
  const onRemove = vi.fn();
  render(
    <MembersTable
      members={membersWithContactFixture}
      {...memberProps}
      onSetCoordinator={onSetCoordinator}
      onRemove={onRemove}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Acties voor Bram Jansen" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Maak coördinator" }));
  expect(onSetCoordinator).toHaveBeenCalledWith(membersWithContactFixture[1], true);
  await userEvent.click(screen.getByRole("button", { name: "Acties voor Bram Jansen" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Verwijder uit werkgroep" }));
  expect(onRemove).toHaveBeenCalledWith(membersWithContactFixture[1]);
});

test("without canSetCoordinator and with canRemove false for coordinators, a coordinator's row has no menu", () => {
  render(
    <MembersTable
      members={membersWithContactFixture}
      {...memberProps}
      canSetCoordinator={false}
      canRemove={(m) => !m.isCoordinator}
    />,
  );
  expect(screen.queryByRole("button", { name: "Acties voor Anna de Vries" })).toBeNull();
  expect(screen.getByRole("button", { name: "Acties voor Bram Jansen" })).toBeVisible();
});

test("links the email address and a plain phone number", () => {
  render(<MembersTable members={membersWithContactFixture} {...memberProps} />);
  const row = within(rowOf("Anna de Vries"));
  expect(row.getByRole("link", { name: "anna@example.test" })).toHaveAttribute(
    "href",
    "mailto:anna@example.test",
  );
  expect(row.getByRole("link", { name: "06 12345678" })).toHaveAttribute("href", "tel:0612345678");
  expect(within(rowOf("Bram Jansen")).queryByText(/^06/)).toBeNull();
});

test("a member who never logged in shows (nog niet ingelogd) and the menu is named for that text", () => {
  render(<MembersTable members={membersWithContactFixture} {...memberProps} />);
  expect(screen.getByText("(nog niet ingelogd)")).toBeVisible();
  expect(screen.getByRole("button", { name: "Acties voor (nog niet ingelogd)" })).toBeVisible();
});

test("members with no rows say so", () => {
  render(<MembersTable members={[]} {...memberProps} />);
  expect(screen.getByText("Deze werkgroep heeft nog geen leden.")).toBeVisible();
});

test("organizations show the contact address, or an empty cell, and open on the name", async () => {
  const onOpen = vi.fn();
  render(<OrganizationTable organizations={organizationsFixture} onOpen={onOpen} />);
  const cells = within(rowOf("Paddenwerkgroep Fictiefdorp").closest("tr")!).getAllByRole("cell");
  expect(cells[1]).toBeEmptyDOMElement();
  expect(screen.getByText("contact@example.test")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Paddentrek Voorbeeldstad" }));
  expect(onOpen).toHaveBeenCalledWith(organizationsFixture[1]!.id);
});

test("organizations with no rows say so", () => {
  render(<OrganizationTable organizations={[]} onOpen={noop} />);
  expect(screen.getByText("Er zijn nog geen organisaties.")).toBeVisible();
});

test("the admins table has no menu without canRemove, and one with it", async () => {
  const onRemove = vi.fn();
  const { rerender } = render(
    <OrganizationAdminsTable
      admins={organizationDetailFixture.admins}
      canRemove={false}
      onRemove={onRemove}
    />,
  );
  expect(screen.queryByRole("button", { name: /Acties voor/ })).toBeNull();
  rerender(
    <OrganizationAdminsTable
      admins={organizationDetailFixture.admins}
      canRemove
      onRemove={onRemove}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Acties voor Beheerder Voorbeeld" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Verwijder als beheerder" }));
  expect(onRemove).toHaveBeenCalledWith(organizationDetailFixture.admins[0]);
  expect(screen.getByText("(nog niet ingelogd)")).toBeVisible();
});

test("markup in a name is shown as text", () => {
  const groups = [{ ...managedWorkingGroupsFixture[0]!, name: "<i>x</i>" }];
  render(<WorkingGroupTable workingGroups={groups} onOpen={noop} />);
  expect(screen.getByText("<i>x</i>")).toBeVisible();
  const members = [{ ...membersWithContactFixture[1]!, name: "<b>y</b>" }];
  render(<MembersTable members={members} {...memberProps} />);
  expect(screen.getByText("<b>y</b>")).toBeVisible();
});

test("an organization admin without a passkey shows Nog geen toegangssleutel; the reset action shows only where mayResetPasskeys", async () => {
  const onResetPasskeys = vi.fn();
  const [first, second] = organizationDetailFixture.admins;
  const admins = [first!, { ...second!, mayResetPasskeys: true }];
  render(
    <OrganizationAdminsTable
      admins={admins}
      canRemove={false}
      onRemove={() => {}}
      onResetPasskeys={onResetPasskeys}
    />,
  );
  expect(screen.getAllByText("Nog geen toegangssleutel")).toHaveLength(1);
  // The first admin may not be reset: no items, so no menu.
  expect(screen.getAllByRole("button", { name: /Acties voor/ })).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: /Acties voor/ }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Verwijder toegangssleutels" }));
  expect(onResetPasskeys).toHaveBeenCalledWith(admins[1]);
});

test("the members table shows the bar in the contact cells", async () => {
  const onReveal = vi.fn();
  const hidden = membersWithContactFixture.map(({ email: _e, phone: _p, ...rest }) => rest);
  render(<MembersTable members={hidden} {...memberProps} onReveal={onReveal} />);
  const buttons = screen.getAllByRole("button", { name: "Toon met je toegangssleutel" });
  expect(buttons).toHaveLength(hidden.length * 2);
  await userEvent.click(buttons[0]!);
  expect(onReveal).toHaveBeenCalledOnce();
});

test("the members table without onReveal shows no bar", () => {
  const hidden = membersWithContactFixture.map(({ email: _e, phone: _p, ...rest }) => rest);
  render(<MembersTable members={hidden} {...memberProps} />);
  expect(screen.queryByRole("button", { name: "Toon met je toegangssleutel" })).toBeNull();
});
