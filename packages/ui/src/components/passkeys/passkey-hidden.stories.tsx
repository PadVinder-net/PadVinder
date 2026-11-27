import type { Meta, StoryObj } from "@storybook/react-vite";
import { DetailRow } from "../contact-rows";
import { PasskeyHidden } from "./passkey-hidden";

const meta = {
  title: "PasskeyHidden",
  component: PasskeyHidden,
  args: { onReveal: () => {} },
  decorators: [
    (Story) => (
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PasskeyHidden>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Short: Story = { args: { width: "short" } };
export const InADetailRow: Story = {
  render: (args) => (
    <dl>
      <DetailRow label="E-mailadres">
        <PasskeyHidden {...args} />
      </DetailRow>
    </dl>
  ),
};
