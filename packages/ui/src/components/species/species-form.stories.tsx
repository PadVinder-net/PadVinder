import type { Meta, StoryObj } from "@storybook/react-vite";
import { connectionMessage, speciesNameTakenMessage } from "../../lib/messages";
import { SpeciesForm } from "./species-form";

const meta = {
  title: "SpeciesForm",
  component: SpeciesForm,
  args: { mode: "create", onSubmit: () => {}, pending: false },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpeciesForm>;
export default meta;

type Story = StoryObj<typeof meta>;

const initial = {
  dutchName: "kamsalamander",
  scientificName: "Triturus cristatus",
  needsVerification: true,
};

export const Create: Story = {};
export const Edit: Story = { args: { mode: "edit", initial } };
export const Pending: Story = { args: { mode: "edit", initial, pending: true } };
export const NameTaken: Story = {
  args: {
    initial: { ...initial, dutchName: "gewone pad" },
    fieldErrors: { dutchName: speciesNameTakenMessage("dutchName") },
  },
};
export const WithError: Story = { args: { mode: "edit", initial, error: connectionMessage } };
