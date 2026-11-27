import type { Member } from "@padvinder/contracts";
import { membersWithContactFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MembersTable } from "./members-table";

const meta = {
  title: "MembersTable",
  component: MembersTable,
  args: {
    members: membersWithContactFixture,
    canSetCoordinator: true,
    canRemove: (_member: Member): boolean => true,
    onSetCoordinator: () => {},
    onRemove: () => {},
  },
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof MembersTable>;
export default meta;

type Story = StoryObj<typeof meta>;

/** An organization admin: may make coordinators and remove anyone. */
export const AsAdmin: Story = {};
/** A coordinator: may remove volunteers, not coordinators, and makes no coordinators. */
export const AsCoordinator: Story = {
  args: { canSetCoordinator: false, canRemove: (member) => !member.isCoordinator },
};
export const Empty: Story = { args: { members: [] } };
/** An unconfirmed admin: the contact details are left out and a bar asks for the passkey. */
export const Hidden: Story = {
  args: {
    members: membersWithContactFixture.map(({ email: _email, phone: _phone, ...rest }) => rest),
    onReveal: () => {},
  },
};
