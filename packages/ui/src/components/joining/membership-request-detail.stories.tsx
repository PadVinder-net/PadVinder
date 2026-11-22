import { requestsForReviewFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MembershipRequestDetail } from "./membership-request-detail";

const [noor, sem] = requestsForReviewFixture;

const meta = {
  title: "MembershipRequestDetail",
  component: MembershipRequestDetail,
  args: { request: noor!, onApprove: () => {}, onReject: () => {}, pending: false },
  decorators: [
    (Story) => (
      // The mobile app is phone only.
      <div className="max-w-[390px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MembershipRequestDetail>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithoutPhone: Story = { args: { request: sem! } };
export const Pending: Story = { args: { pending: true } };
export const WithError: Story = {
  args: { error: "Het lukt nu niet. Controleer je verbinding en probeer het opnieuw." },
};
export const AlreadyHandled: Story = {
  args: { request: { ...noor!, status: "approved", decidedAt: "2027-01-12T09:30:00.000+01:00" } },
};
export const DeletedApplicant: Story = {
  args: {
    request: { ...noor!, applicant: { id: noor!.applicant.id, name: "Verwijderd account" } },
  },
};
export const NamelessApplicant: Story = {
  args: { request: { ...noor!, applicant: { ...noor!.applicant, name: "" } } },
};
