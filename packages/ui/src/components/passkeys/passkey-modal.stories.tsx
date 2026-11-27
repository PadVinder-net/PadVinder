import type { Meta, StoryObj } from "@storybook/react-vite";
import { PasskeyModal } from "./passkey-modal";

const meta = {
  title: "PasskeyModal",
  component: PasskeyModal,
  args: {
    open: true,
    hasPasskey: true,
    pending: false,
    error: null,
    onConfirm: () => {},
    onCancel: () => {},
    onLogInAgain: () => {},
  },
  // The modal serves the app (a phone) and the portal; a dialog is portaled, so the story needs a
  // box of its own for the screenshot, as the Modal story has.
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[800px] max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PasskeyModal>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Confirm: Story = {};
export const Create: Story = { args: { hasPasskey: false } };
export const Pending: Story = { args: { pending: true } };
export const Cancelled: Story = { args: { error: "cancelled" } };
export const OtherAccount: Story = { args: { error: "other_account" } };
export const SessionTooOld: Story = { args: { hasPasskey: false, error: "session_too_old" } };
export const Unsupported: Story = { args: { hasPasskey: false, error: "unsupported" } };
