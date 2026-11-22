import { requestsForReviewFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MembershipRequestList } from "./membership-request-list";

const [noor, sem, fleur] = requestsForReviewFixture;

const meta = {
  title: "MembershipRequestList",
  component: MembershipRequestList,
  args: { groups: [], onOpen: () => {} },
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MembershipRequestList>;
export default meta;

type Story = StoryObj<typeof meta>;

export const OneGroup: Story = {
  args: { groups: [{ workingGroup: noor!.workingGroup, requests: [noor!, sem!] }] },
};
export const TwoGroups: Story = {
  args: {
    groups: [
      { workingGroup: noor!.workingGroup, requests: [noor!, sem!] },
      { workingGroup: fleur!.workingGroup, requests: [fleur!] },
    ],
  },
};
export const Empty: Story = {};
