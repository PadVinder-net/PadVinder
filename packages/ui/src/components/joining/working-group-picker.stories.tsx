import { workingGroupsFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkingGroupPicker } from "./working-group-picker";

const meta = {
  title: "WorkingGroupPicker",
  component: WorkingGroupPicker,
  args: { workingGroups: workingGroupsFixture, onJoin: () => {}, pending: false },
  decorators: [
    (Story) => (
      // The mobile app is phone only; a fixed height makes the list scroll.
      <div className="h-[640px] max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkingGroupPicker>;
export default meta;

type Story = StoryObj<typeof meta>;

// Play functions do not run in the visual tests, so the start state is set with props.
const noord = workingGroupsFixture[2]!.id;

export const Default: Story = { args: { initialChosenId: noord } };
export const Filtered: Story = { args: { initialQuery: "fictiefdorp" } };
export const NoMatch: Story = { args: { initialQuery: "xyz" } };
export const AfterRejection: Story = { args: { rejectedFrom: "Noord" } };
export const Pending: Story = { args: { pending: true, initialChosenId: noord } };
export const WithError: Story = {
  args: { error: "Het lukt nu niet. Probeer het straks nog eens.", initialChosenId: noord },
};
