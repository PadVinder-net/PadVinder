import { addMembersResultFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AddMembersResults } from "./add-members-results";

const meta = {
  title: "AddMembersResults",
  component: AddMembersResults,
  args: { results: addMembersResultFixture.results, onClose: () => {} },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof AddMembersResults>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
