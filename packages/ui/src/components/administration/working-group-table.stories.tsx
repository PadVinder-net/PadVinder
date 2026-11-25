import { managedWorkingGroupsFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkingGroupTable } from "./working-group-table";

const meta = {
  title: "WorkingGroupTable",
  component: WorkingGroupTable,
  args: { workingGroups: managedWorkingGroupsFixture, onOpen: () => {} },
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof WorkingGroupTable>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const OneOrganization: Story = {
  args: { workingGroups: managedWorkingGroupsFixture.slice(0, 2) },
};
export const Empty: Story = { args: { workingGroups: [] } };
