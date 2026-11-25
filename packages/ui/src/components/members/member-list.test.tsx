import {
  membersFixture,
  membersWithContactFixture,
  workingGroupsFixture,
} from "@padvinder/contracts/fixtures";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MemberList } from "./member-list";

const noord = workingGroupsFixture[2]!;
const zuidOost = workingGroupsFixture[4]!;

test("one group shows no subheading; two groups show two", () => {
  const { unmount } = render(
    <MemberList groups={[{ workingGroup: noord, members: membersFixture }]} />,
  );
  expect(screen.getByRole("heading", { name: "Leden" })).toBeVisible();
  expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  unmount();
  render(
    <MemberList
      groups={[
        { workingGroup: noord, members: membersFixture },
        { workingGroup: zuidOost, members: [] },
      ]}
    />,
  );
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  expect(screen.getByText("Deze werkgroep heeft nog geen leden.")).toBeVisible();
});

test("coordinators are marked", () => {
  render(<MemberList groups={[{ workingGroup: noord, members: membersFixture }]} />);
  expect(screen.getAllByText("coördinator")).toHaveLength(1);
  expect(screen.getByText("Anna de Vries").parentElement).toHaveTextContent("coördinator");
});

test("rows open the member when onOpen is given, otherwise are plain", async () => {
  const onOpen = vi.fn();
  const { unmount } = render(
    <MemberList groups={[{ workingGroup: noord, members: membersFixture }]} onOpen={onOpen} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /Bram Jansen/ }));
  expect(onOpen).toHaveBeenCalledWith(membersFixture[1]!.membershipId);
  unmount();
  render(<MemberList groups={[{ workingGroup: noord, members: membersFixture }]} />);
  expect(screen.queryByRole("button")).toBeNull();
});

test("with canOpen, only the rows of groups it allows open", async () => {
  const onOpen = vi.fn();
  const zuidOostMember = {
    ...membersFixture[1]!,
    membershipId: "0192f3c0-0000-7000-8000-0000000000e9",
    name: "Lotte Smit",
  };
  render(
    <MemberList
      groups={[
        { workingGroup: noord, members: membersFixture },
        { workingGroup: zuidOost, members: [zuidOostMember] },
      ]}
      onOpen={onOpen}
      canOpen={(workingGroupId) => workingGroupId === noord.id}
    />,
  );
  expect(screen.getByRole("button", { name: /Bram Jansen/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Lotte Smit/ })).toBeNull();
  expect(screen.getByText("Lotte Smit")).toBeVisible();
});

test("a member without a name, and one who never logged in, get their placeholder", () => {
  render(
    <MemberList
      groups={[
        {
          workingGroup: noord,
          members: [membersFixture[3]!, { ...membersWithContactFixture[3]!, name: "" }],
        },
      ]}
    />,
  );
  expect(screen.getByText("(nog geen naam)")).toBeVisible();
  expect(screen.getByText("(nog niet ingelogd)")).toBeVisible();
});
