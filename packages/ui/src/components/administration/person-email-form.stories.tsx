import type { Meta, StoryObj } from "@storybook/react-vite";
import { PersonEmailForm } from "./person-email-form";

const meta = {
  title: "PersonEmailForm",
  component: PersonEmailForm,
  args: {
    hint: "Heeft deze persoon nog geen account? Dan wordt het aangemaakt.",
    submitLabel: "Maak beheerder",
    onSubmit: () => {},
    pending: false,
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PersonEmailForm>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Create: Story = {};
export const Edit: Story = { args: { hint: undefined, submitLabel: "Voeg toe" } };
export const Pending: Story = { args: { pending: true } };
export const WithFieldError: Story = { args: { fieldError: "Vul een geldig e-mailadres in." } };
