import { reviewableRequestsFixture } from "@padvinder/contracts/fixtures";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MembershipRequestTable } from "./membership-request-table";

const [lotte, daan, mila] = reviewableRequestsFixture;
const groups = [
  { workingGroup: lotte!.workingGroup, requests: [lotte!, daan!] },
  { workingGroup: mila!.workingGroup, requests: [mila!] },
];

test("the table groups by working group and shows the organization only when asked", () => {
  const { rerender } = render(
    <MembershipRequestTable groups={groups} showOrganization={false} onOpen={vi.fn()} />,
  );
  expect(screen.getAllByRole("table")).toHaveLength(2);
  expect(screen.getByRole("heading", { name: lotte!.workingGroup.name })).toBeVisible();
  const first = screen.getAllByRole("table")[0]!;
  expect(within(first).getByRole("columnheader", { name: "Naam" })).toBeVisible();
  expect(within(first).getByRole("columnheader", { name: "Aangemeld op" })).toBeVisible();
  expect(within(first).getByText("8 januari 2027")).toBeVisible();
  expect(within(first).getByRole("button", { name: "Daan Smit" })).toBeVisible();
  expect(screen.queryByText(new RegExp(lotte!.workingGroup.organization.name))).toBeNull();
  rerender(<MembershipRequestTable groups={groups} showOrganization onOpen={vi.fn()} />);
  expect(
    screen.getByRole("heading", {
      name: `${lotte!.workingGroup.name} (${lotte!.workingGroup.organization.name})`,
    }),
  ).toBeVisible();
});

test("a name opens its request", async () => {
  const onOpen = vi.fn();
  render(<MembershipRequestTable groups={groups} showOrganization={false} onOpen={onOpen} />);
  await userEvent.click(screen.getByRole("button", { name: "Mila Peters" }));
  expect(onOpen).toHaveBeenCalledWith(mila!.id);
});

test("groups without requests are left out, and no requests at all says so", () => {
  const { rerender } = render(
    <MembershipRequestTable
      groups={[{ workingGroup: lotte!.workingGroup, requests: [] }, groups[1]!]}
      showOrganization={false}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getAllByRole("table")).toHaveLength(1);
  rerender(<MembershipRequestTable groups={[]} showOrganization={false} onOpen={vi.fn()} />);
  expect(screen.getByText("Er zijn geen open aanmeldingen.")).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
});
