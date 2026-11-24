import { membersFixture, membersWithContactFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemberDetail } from "./member-detail";

const meta = {
  title: "MemberDetail",
  component: MemberDetail,
  args: {
    member: membersWithContactFixture[0]!,
    workingGroupName: "Noord",
    canRemove: true,
    onRemove: () => {},
    pending: false,
  },
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MemberDetail>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Coordinator: Story = {};
export const WithoutPhone: Story = { args: { member: membersWithContactFixture[1]! } };
export const WithoutContact: Story = { args: { member: membersFixture[1]!, canRemove: false } };
export const Pending: Story = { args: { pending: true } };
export const WithError: Story = {
  args: { error: "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw." },
};
export const Nameless: Story = {
  args: { member: { ...membersWithContactFixture[1]!, name: "" } },
};
