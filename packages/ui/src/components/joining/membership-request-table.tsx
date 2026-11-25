import type { MembershipRequestForReview, WorkingGroupSummary } from "@padvinder/contracts";
import { displayName } from "../../lib/display-name";
import { formatDate } from "../../lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

export type MembershipRequestTableProps = {
  /** Already grouped by the caller, in the order to show. */
  groups: { workingGroup: WorkingGroupSummary; requests: MembershipRequestForReview[] }[];
  /** Name the organization after the working group, for someone who reviews in several. */
  showOrganization: boolean;
  onOpen(requestId: string): void;
};

export function MembershipRequestTable({
  groups,
  showOrganization,
  onOpen,
}: MembershipRequestTableProps) {
  const filled = groups.filter((group) => group.requests.length > 0);
  if (filled.length === 0) {
    return <p className="text-lg">Er zijn geen open aanmeldingen.</p>;
  }
  return (
    <div className="flex flex-col gap-8">
      {filled.map(({ workingGroup, requests }) => (
        <section key={workingGroup.id} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">
            {showOrganization
              ? `${workingGroup.name} (${workingGroup.organization.name})`
              : workingGroup.name}
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naam</TableHead>
                <TableHead>Aangemeld op</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium underline underline-offset-4"
                      onClick={() => onOpen(request.id)}
                    >
                      {displayName(request.applicant.name)}
                    </button>
                  </TableCell>
                  <TableCell>{formatDate(request.requestedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}
