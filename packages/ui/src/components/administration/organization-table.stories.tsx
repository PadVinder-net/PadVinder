import { organizationsFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { OrganizationTable } from "./organization-table";

const meta = {
  title: "OrganizationTable",
  component: OrganizationTable,
  args: { organizations: organizationsFixture, onOpen: () => {} },
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof OrganizationTable>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { organizations: [] } };
