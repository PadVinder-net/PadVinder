import type { Meta, StoryObj } from "@storybook/react-vite";
import { CrashScreen } from "./crash-screen";

const meta = {
  title: "CrashScreen",
  component: CrashScreen,
  args: { variant: "app", onReload: () => {}, onReport: () => {} },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CrashScreen>;
export default meta;

type Story = StoryObj<typeof meta>;

export const App: Story = {};
/** Before login: nobody to send a report for. */
export const AppBeforeLogin: Story = { args: { onReport: undefined } };
export const Portal: Story = {
  args: { variant: "portal" },
  parameters: { visualViewport: { width: 1024, height: 768 } },
};
export const PortalBeforeLogin: Story = {
  args: { variant: "portal", onReport: undefined },
  parameters: { visualViewport: { width: 1024, height: 768 } },
};
