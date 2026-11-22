import type { Meta, StoryObj } from "@storybook/react-vite";
import { WaitingForApproval } from "./waiting-for-approval";

const meta = {
  title: "WaitingForApproval",
  component: WaitingForApproval,
  args: {
    workingGroupName: "Noord",
    onWithdraw: () => {},
    onLogOut: () => {},
    onOpenProfile: () => {},
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
} satisfies Meta<typeof WaitingForApproval>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Pending: Story = { args: { pending: true } };
