import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmailForm } from "./email-form";

const meta = {
  title: "EmailForm",
  component: EmailForm,
  args: { onSubmit: () => {}, pending: false },
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EmailForm>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Pending: Story = { args: { pending: true } };
export const WithError: Story = {
  args: { error: "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw." },
};
export const WithNotice: Story = { args: { notice: "Je account is verwijderd." } };
