import { speciesFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SpeciesTable } from "./species-table";

const meta = {
  title: "SpeciesTable",
  component: SpeciesTable,
  args: { species: speciesFixture, onEdit: () => {}, onSetActive: () => {} },
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof SpeciesTable>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
