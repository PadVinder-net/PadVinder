import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodeForm } from "./code-form";

const meta = {
  title: "CodeForm",
  component: CodeForm,
  args: {
    email: "noor@example.test",
    onSubmit: () => {},
    onResend: () => {},
    onChangeEmail: () => {},
    onOpenMail: () => {},
    pending: false,
  },
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CodeForm>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Pending: Story = { args: { pending: true } };
export const WrongCode: Story = {
  args: { error: "Deze code klopt niet. Kijk nog eens in je mail." },
};
export const Resent: Story = { args: { resent: true } };
export const WithoutOpenMail: Story = { args: { onOpenMail: undefined } };
