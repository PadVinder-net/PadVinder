import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextButton } from "./text-button";

const meta = {
  title: "TextButton",
  component: TextButton,
  args: { children: "Log uit", onClick: () => {} },
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TextButton>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
