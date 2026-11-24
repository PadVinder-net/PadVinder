import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConfirmDialog } from "./confirm-dialog";

const meta = {
  title: "ConfirmDialog",
  component: ConfirmDialog,
  args: {
    open: true,
    title: "Aanmelding intrekken?",
    text: "Je kunt daarna een andere werkgroep kiezen.",
    confirmLabel: "Trek aanmelding in",
    onConfirm: () => {},
    onCancel: () => {},
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="h-[800px] max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConfirmDialog>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Destructive: Story = { args: { destructive: true } };
