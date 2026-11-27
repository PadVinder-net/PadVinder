import type { Meta, StoryObj } from "@storybook/react-vite";
import { NameForm } from "./name-form";

const meta = {
  title: "NameForm",
  component: NameForm,
  args: { onSubmit: () => {}, onLogOut: () => {}, pending: false },
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NameForm>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Pending: Story = { args: { pending: true } };
export const LogOutFailed: Story = { args: { logOutFailed: true } };
