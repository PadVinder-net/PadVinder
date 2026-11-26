import { auditActionGroups } from "@padvinder/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AuditLogFilters } from "./audit-log-filters";

const voorbeeldstad = {
  id: "0192f3c0-0000-7000-8000-0000000000a1",
  name: "Paddentrek Voorbeeldstad",
};
const fictiefdorp = {
  id: "0192f3c0-0000-7000-8000-0000000000a2",
  name: "Paddenwerkgroep Fictiefdorp",
};

const meta = {
  title: "AuditLogFilters",
  component: AuditLogFilters,
  args: {
    organizations: [voorbeeldstad, fictiefdorp],
    actionGroups: [...auditActionGroups],
    value: { organizationId: null, actionGroup: null },
    onChange: () => {},
  },
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof AuditLogFilters>;
export default meta;

type Story = StoryObj<typeof meta>;

export const ForPlatformAdmin: Story = {};
/** One organization, so no select for it; and no accounts or species, which it never sees. */
export const ForOrganizationAdmin: Story = {
  args: {
    organizations: [voorbeeldstad],
    actionGroups: ["organization", "workingGroup", "role", "membership"],
    value: { organizationId: null, actionGroup: "membership" },
  },
};
