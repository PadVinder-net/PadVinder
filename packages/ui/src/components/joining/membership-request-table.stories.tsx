import type { MembershipRequestForReview } from "@padvinder/contracts";
import { reviewableRequestsFixture } from "@padvinder/contracts/fixtures";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MembershipRequestTable } from "./membership-request-table";

/** Groups a flat list by working group, keeping the order of first appearance. */
function groupByWorkingGroup(requests: MembershipRequestForReview[]) {
  const groups = new Map<
    string,
    { workingGroup: MembershipRequestForReview["workingGroup"]; requests: typeof requests }
  >();
  for (const request of requests) {
    const group = groups.get(request.workingGroup.id) ?? {
      workingGroup: request.workingGroup,
      requests: [],
    };
    group.requests.push(request);
    groups.set(request.workingGroup.id, group);
  }
  return [...groups.values()];
}

const [lotte, daan, mila] = reviewableRequestsFixture;
const otherOrganizationGroup = {
  id: "0192f3c0-0000-7000-8000-0000000000f1",
  name: "Dorp",
  city: "Fictiefdorp",
  organization: { id: "0192f3c0-0000-7000-8000-0000000000f2", name: "Paddenwerkgroep Fictiefdorp" },
};

const meta = {
  title: "MembershipRequestTable",
  component: MembershipRequestTable,
  args: {
    groups: groupByWorkingGroup(reviewableRequestsFixture),
    showOrganization: false,
    onOpen: () => {},
  },
  // The portal is a desktop layout.
  parameters: { visualViewport: { width: 1024, height: 768 } },
} satisfies Meta<typeof MembershipRequestTable>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** Someone who reviews in two organizations sees which one each group belongs to. */
export const WithOrganizations: Story = {
  args: {
    showOrganization: true,
    groups: groupByWorkingGroup([
      lotte!,
      daan!,
      mila!,
      {
        ...mila!,
        id: "0192f3c0-0000-7000-8000-0000000000e4",
        workingGroup: otherOrganizationGroup,
        applicant: {
          id: "0192f3c0-0000-7000-8000-000000000008",
          name: "Sanne de Boer",
          email: "sanne@example.test",
          phone: null,
        },
      },
    ]),
  },
};
export const Empty: Story = { args: { groups: [] } };
