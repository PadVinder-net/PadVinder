import { membersFixture, workingGroupsFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemberList } from "./member-list";

const noord = workingGroupsFixture[2]!;
const zuidOost = workingGroupsFixture[4]!;

const meta = {
  title: "MemberList",
  component: MemberList,
  args: { groups: [{ workingGroup: noord, members: membersFixture }], onOpen: () => {} },
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MemberList>;
export default meta;

type Story = StoryObj<typeof meta>;

export const OneGroup: Story = {};
export const TwoGroups: Story = {
  args: {
    groups: [
      { workingGroup: noord, members: membersFixture },
      { workingGroup: zuidOost, members: [] },
    ],
  },
};
export const NotOpenable: Story = { args: { onOpen: undefined } };
