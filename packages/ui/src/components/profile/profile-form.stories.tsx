import {
  applicantMeFixture,
  meFixture,
  twoOrganizationsMeFixture,
} from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProfileForm } from "./profile-form";

const meta = {
  title: "ProfileForm",
  component: ProfileForm,
  args: { me: meFixture, onSave: () => {}, onDelete: () => {}, saving: false, deleting: false },
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProfileForm>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Saved: Story = { args: { saved: true } };
export const Saving: Story = { args: { saving: true } };
export const Deleting: Story = { args: { deleting: true } };
export const WithError: Story = {
  args: { error: "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw." },
};
export const TwoGroups: Story = { args: { me: twoOrganizationsMeFixture } };
export const NoGroups: Story = { args: { me: applicantMeFixture } };
export const WithPendingRequest: Story = {
  args: {
    pendingRequest: { workingGroupName: "Zuid" },
    onWithdrawRequest: () => {},
    withdrawing: false,
  },
};
export const CanJoinAnother: Story = { args: { onJoinAnother: () => {} } };
