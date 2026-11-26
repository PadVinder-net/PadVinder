import type { Meta, StoryObj } from "@storybook/react-vite";
import { Modal } from "../modal";
import { ProblemReportForm, problemReportTitle } from "./problem-report-form";

const filled =
  "Ik tikte op Leden en toen bleef het scherm wit. Daarna deed de knop Terug ook niets meer.";

const meta = {
  title: "ProblemReportForm",
  component: ProblemReportForm,
  args: {
    name: "Anne de Vries",
    email: "anne@example.test",
    onSubmit: async () => {},
  },
  decorators: [
    (Story, { parameters }) =>
      // The mobile app is phone only; the portal's story brings its own frame.
      parameters.visualViewport ? (
        <Story />
      ) : (
        <div className="max-w-[390px] p-4">
          <Story />
        </div>
      ),
  ],
} satisfies Meta<typeof ProblemReportForm>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Filled: Story = { args: { initialMessage: filled } };
export const WithContact: Story = {
  args: { initialMessage: filled, initialIncludeContact: true },
};
export const Sending: Story = { args: { initialMessage: filled, sending: true } };
export const Failed: Story = {
  args: {
    initialMessage: filled,
    errorText: "Je melding is niet verstuurd. Probeer het zo nog eens.",
  },
};

/** The portal opens the form in a modal, from the navigation. */
export const InPortalModal: Story = {
  args: { heading: false, initialMessage: filled },
  parameters: { layout: "fullscreen", visualViewport: { width: 1024, height: 768 } },
  decorators: [
    (Story) => (
      <div className="h-[768px]">
        <Modal open title={problemReportTitle} onClose={() => {}}>
          <Story />
        </Modal>
      </div>
    ),
  ],
};
