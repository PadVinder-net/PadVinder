import { auditLogFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AuditLogTable } from "./audit-log-table";

const meta = {
  title: "AuditLogTable",
  component: AuditLogTable,
  args: { entries: auditLogFixture, showOrganization: false },
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof AuditLogTable>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithOrganization: Story = { args: { showOrganization: true } };
export const Empty: Story = { args: { entries: [] } };
