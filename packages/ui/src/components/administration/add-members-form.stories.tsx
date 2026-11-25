import type { Meta, StoryObj } from "@storybook/react-vite";
import { AddMembersForm } from "./add-members-form";

const meta = {
  title: "AddMembersForm",
  component: AddMembersForm,
  args: { onSubmit: () => {}, pending: false },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof AddMembersForm>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
const list = "noor@example.test\nbram@example.test";
export const WithWrongLines: Story = {
  args: { initialText: `${list}\n\njan@\nJan Jansen <jan@example.test>` },
};
export const TooMany: Story = {
  args: {
    initialText: Array.from({ length: 201 }, (_, i) => `persoon${i}@example.test`).join("\n"),
  },
};
export const Pending: Story = { args: { initialText: list, pending: true } };
export const WithError: Story = {
  args: {
    initialText: list,
    error: "Je hebt vandaag te veel mensen toegevoegd. Probeer het morgen opnieuw.",
  },
};
