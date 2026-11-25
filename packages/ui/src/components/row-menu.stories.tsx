import type { Meta, StoryObj } from "@storybook/react-vite";
import { RowMenu } from "./row-menu";

const meta = {
  title: "RowMenu",
  component: RowMenu,
  args: {
    label: "Acties voor Noord",
    items: [
      { label: "Wijzig", onSelect: () => {} },
      { label: "Zet uit", onSelect: () => {}, destructive: true },
    ],
  },
  decorators: [
    (Story) => (
      <div className="flex h-48 justify-end p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RowMenu>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
export const Open: Story = { args: { defaultOpen: true } };
