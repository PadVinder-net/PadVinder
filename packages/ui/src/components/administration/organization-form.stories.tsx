import type { Meta, StoryObj } from "@storybook/react-vite";
import { organizationNameTakenMessage } from "../../lib/messages";
import { OrganizationForm } from "./organization-form";

const meta = {
  title: "OrganizationForm",
  component: OrganizationForm,
  args: { mode: "create", canRename: true, onSubmit: () => {}, pending: false },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OrganizationForm>;
export default meta;

type Story = StoryObj<typeof meta>;

const initial = { name: "Paddentrek Voorbeeldstad", contactEmail: "info@example.test" };

export const Create: Story = {};
export const Edit: Story = { args: { mode: "edit", initial } };
export const EditWithoutRename: Story = { args: { mode: "edit", canRename: false, initial } };
export const Pending: Story = { args: { mode: "edit", initial, pending: true } };
export const WithFieldError: Story = {
  args: {
    initial: { name: "Paddentrek Voorbeeldstad", contactEmail: null },
    fieldErrors: { name: organizationNameTakenMessage },
  },
};
