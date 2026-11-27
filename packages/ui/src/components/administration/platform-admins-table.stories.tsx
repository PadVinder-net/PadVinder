import { platformAdminsFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlatformAdminsTable } from "./platform-admins-table";

const meta = {
  title: "PlatformAdminsTable",
  component: PlatformAdminsTable,
  args: { admins: platformAdminsFixture, onRemove: () => {} },
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof PlatformAdminsTable>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithReset: Story = {
  args: { onResetPasskeys: () => {}, canResetPasskeys: () => true },
};
