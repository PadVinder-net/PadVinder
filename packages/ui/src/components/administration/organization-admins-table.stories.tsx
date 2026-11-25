import { organizationDetailFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { OrganizationAdminsTable } from "./organization-admins-table";

const meta = {
  title: "OrganizationAdminsTable",
  component: OrganizationAdminsTable,
  args: { admins: organizationDetailFixture.admins, canRemove: true, onRemove: () => {} },
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof OrganizationAdminsTable>;
export default meta;

type Story = StoryObj<typeof meta>;

export const AsPlatformAdmin: Story = {};
export const AsOrganizationAdmin: Story = { args: { canRemove: false } };
