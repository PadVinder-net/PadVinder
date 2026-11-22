import type { MembershipRequestForReview, WorkingGroupSummary } from "@padvinder/contracts";
import { formatDate } from "../../lib/format";
import { displayName } from "../../lib/display-name";

export type MembershipRequestListProps = {
  groups: { workingGroup: WorkingGroupSummary; requests: MembershipRequestForReview[] }[];
  onOpen(requestId: string): void;
};

export function MembershipRequestList({ groups, onOpen }: MembershipRequestListProps) {
  const isEmpty = groups.every((group) => group.requests.length === 0);
  return (
    <section className="flex flex-col gap-4 text-lg">
      <h2 className="text-2xl font-semibold">Aanmeldingen</h2>
      {isEmpty ? <p>Er zijn geen open aanmeldingen.</p> : null}
      {groups
        .filter((group) => group.requests.length > 0)
        .map(({ workingGroup, requests }) => (
          <div key={workingGroup.id} className="flex flex-col gap-2">
            {groups.length > 1 ? (
              <h3 className="text-xl font-semibold">{workingGroup.name}</h3>
            ) : null}
            <ul className="flex flex-col gap-2">
              {requests.map((request) => (
                <li key={request.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(request.id)}
                    className="flex min-h-14 w-full flex-col items-start rounded-lg border bg-card px-4 py-3 text-left"
                  >
                    <span className="font-medium">{displayName(request.applicant.name)}</span>
                    <span className="text-base text-muted-foreground">
                      Aangemeld op {formatDate(request.requestedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}
