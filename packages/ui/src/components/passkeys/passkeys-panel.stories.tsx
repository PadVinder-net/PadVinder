import { passkeysFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PasskeysPanel } from "./passkeys-panel";

const meta = {
  title: "PasskeysPanel",
  component: PasskeysPanel,
  args: {
    passkeys: passkeysFixture.passkeys,
    loading: false,
    loadFailed: false,
    onRetry: () => {},
    creating: false,
    createError: null,
    onCreate: () => {},
    removing: false,
    onRemove: () => {},
    phoneHint: false,
  },
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof PasskeysPanel>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { passkeys: [] } };
export const WithPhoneHint: Story = { args: { phoneHint: true } };
export const CreateFailed: Story = { args: { createError: "cancelled" } };
export const Loading: Story = { args: { passkeys: undefined, loading: true } };
