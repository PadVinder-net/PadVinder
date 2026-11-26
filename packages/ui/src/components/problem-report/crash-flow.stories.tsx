import type { Meta, StoryObj } from "@storybook/react-vite";
import { CrashFlow } from "./crash-flow";

const meta = {
  title: "CrashFlow",
  component: CrashFlow,
  args: {
    variant: "app",
    contact: { name: "Anne de Vries", email: "anne@example.test" },
    onReload: () => {},
    onSend: async () => {},
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CrashFlow>;
export default meta;

type Story = StoryObj<typeof meta>;

/** "Vertel wat er gebeurde" opens the form in place of the crash text. */
export const Form: Story = { args: { initialStep: "form" } };
export const Sent: Story = { args: { initialStep: "sent" } };
