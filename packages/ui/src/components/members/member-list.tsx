import type { Member, WorkingGroupSummary } from "@padvinder/contracts";
import { displayName } from "../../lib/display-name";

export type MemberListProps = {
  groups: { workingGroup: WorkingGroupSummary; members: Member[] }[];
  /** Without it the rows are plain text. */
  onOpen?(membershipId: string): void;
  /** Whether the rows of a group open; without it every row opens when `onOpen` is given. */
  canOpen?(workingGroupId: string): boolean;
};

const rowClass = "flex min-h-14 w-full items-center gap-2 rounded-lg border bg-card px-4 py-3";

export function MemberList({ groups, onOpen, canOpen = () => true }: MemberListProps) {
  return (
    <section className="flex flex-col gap-4 text-lg">
      <h2 className="text-2xl font-semibold">Leden</h2>
      {groups.map(({ workingGroup, members }) => {
        const open = onOpen && canOpen(workingGroup.id) ? onOpen : undefined;
        return (
          <div key={workingGroup.id} className="flex flex-col gap-2">
            {groups.length > 1 ? (
              <h3 className="text-xl font-semibold">{workingGroup.name}</h3>
            ) : null}
            {members.length === 0 ? (
              <p>Deze werkgroep heeft nog geen leden.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {members.map((member) => {
                  const content = (
                    <>
                      <span className="font-medium">{displayName(member.name)}</span>
                      {member.isCoordinator ? (
                        <span className="text-base text-muted-foreground">coördinator</span>
                      ) : null}
                    </>
                  );
                  return (
                    <li key={member.membershipId}>
                      {open ? (
                        <button
                          type="button"
                          onClick={() => open(member.membershipId)}
                          className={`${rowClass} text-left`}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className={rowClass}>{content}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
