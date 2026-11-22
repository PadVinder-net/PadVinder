import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoginFlow } from "./login-flow";

const meta = {
  title: "LoginFlow",
  component: LoginFlow,
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LoginFlow>;
export default meta;

type Story = StoryObj<typeof meta>;

const later = () => new Promise<void>((resolve) => setTimeout(resolve, 400));

/** Fake functions: any six digits log in, except 000000. */
export const Default: Story = {
  args: {
    requestLoginCode: async () => {
      await later();
      return { ok: true };
    },
    logInWithCode: async (_email, code) => {
      await later();
      return code === "000000"
        ? { ok: false, message: "Deze code klopt niet. Kijk nog eens in je mail." }
        : { ok: true };
    },
    onLoggedIn: () => {},
    onOpenMail: () => {},
  },
};
