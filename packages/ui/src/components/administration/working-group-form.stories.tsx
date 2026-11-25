import type { Meta, StoryObj } from "@storybook/react-vite";
import { workingGroupNameTakenMessage } from "../../lib/messages";
import { WorkingGroupForm } from "./working-group-form";

const meta = {
  title: "WorkingGroupForm",
  component: WorkingGroupForm,
  args: {
    mode: "create",
    organizations: [
      { id: "0192f3c0-0000-7000-8000-0000000000a1", name: "Paddentrek Voorbeeldstad" },
    ],
    ownEmail: "hoofdbeheerder@example.test",
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
} satisfies Meta<typeof WorkingGroupForm>;
export default meta;

type Story = StoryObj<typeof meta>;

const initial = { name: "Noord", city: "Voorbeeldstad" };

export const Create: Story = {};
export const WithSeveralOrganizations: Story = {
  args: {
    organizations: [
      { id: "0192f3c0-0000-7000-8000-0000000000a1", name: "Paddentrek Voorbeeldstad" },
      { id: "0192f3c0-0000-7000-8000-0000000000a2", name: "Paddenwerkgroep Fictiefdorp" },
    ],
  },
};
export const Edit: Story = { args: { mode: "edit", initial } };
export const Pending: Story = { args: { mode: "edit", initial, pending: true } };
export const WithFieldError: Story = {
  args: { initial, fieldErrors: { name: workingGroupNameTakenMessage } },
};
