import { accountSummaryFixture, accountWithoutGroupsFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AccountSummaryCard } from "./account-summary-card";

const meta = {
  title: "AccountSummaryCard",
  component: AccountSummaryCard,
  args: { account: accountSummaryFixture, own: false, onDelete: () => {} },
  parameters: { visualViewport: { width: 640, height: 480 } },
} satisfies Meta<typeof AccountSummaryCard>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    account: {
      ...accountSummaryFixture,
      isPlatformAdmin: true,
      organizationAdminOf: [
        { id: "0192f3c0-0000-7000-8000-0000000000a1", name: "Paddentrek Voorbeeldstad" },
      ],
    },
  },
};
export const WithoutGroups: Story = { args: { account: accountWithoutGroupsFixture } };
export const Own: Story = { args: { own: true } };
