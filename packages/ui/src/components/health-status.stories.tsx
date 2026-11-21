import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  databaseUnreachableFixture,
  healthyFixture,
  workerStaleFixture,
} from "@padvinder/contracts/fixtures";
import { HealthStatus } from "./health-status";

const meta = {
  title: "HealthStatus",
  component: HealthStatus,
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HealthStatus>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Healthy: Story = { args: { health: healthyFixture } };
export const WorkerStale: Story = { args: { health: workerStaleFixture } };
export const DatabaseUnreachable: Story = { args: { health: databaseUnreachableFixture } };
export const Loading: Story = { args: {} };
export const LoadFailed: Story = { args: { loadFailed: true } };
