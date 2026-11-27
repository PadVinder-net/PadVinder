import type { Meta, StoryObj } from "@storybook/react-vite";
import { AuthGateView } from "./auth-gate-view";

// The login and name steps have their own stories (LoginFlow, NameForm).
const meta = {
  title: "AuthGateView",
  component: AuthGateView,
  args: {
    state: "loading",
    onRetry: () => {},
    login: {
      requestLoginCode: async () => ({ ok: true }),
      logInWithCode: async () => ({ ok: true }),
      onLoggedIn: () => {},
    },
    saveName: { pending: false, failed: false, submit: () => {} },
    logOut: { submit: () => {}, failed: false },
    children: null,
  },
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AuthGateView>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
export const LoadFailed: Story = { args: { state: "failed" } };
