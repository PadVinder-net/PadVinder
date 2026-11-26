import {
  apiErrorCode,
  mayRemoveMember,
  useMe,
  useRemoveMembership,
  type MeResponse,
} from "@padvinder/api-client";
import { apiErrorMessage, MemberDetail, nameInSentence } from "@padvinder/ui";
import { useNavigate, useParams } from "react-router";
import { LoadError, Loading, SubScreen, type FlashState } from "./sub-screen";
import { useMemberLists } from "./working-group-lists";

const listPath = "/more/members";

/** One member: contact details for coordinators and admins, and "Verwijder uit werkgroep". */
export function MemberScreen() {
  const me = useMe().data;
  const { membershipId = "" } = useParams();
  if (!me) return null;
  return (
    <SubScreen back={listPath}>
      <MemberOfGroup me={me} membershipId={membershipId} />
    </SubScreen>
  );
}

/** There is no endpoint for one membership: the member is found in the lists of the user's groups. */
function MemberOfGroup({ me, membershipId }: { me: MeResponse; membershipId: string }) {
  const navigate = useNavigate();
  const lists = useMemberLists(me);
  const remove = useRemoveMembership();

  const found = lists.groups
    .flatMap(({ workingGroup, members }) => members.map((member) => ({ workingGroup, member })))
    .find(({ member }) => member.membershipId === membershipId);

  if (!found) {
    if (lists.error) return <LoadError error={lists.error} onRetry={lists.refetch} />;
    if (lists.isPending) return <Loading>Lid laden…</Loading>;
    return <p className="text-lg">{apiErrorMessage("not_found")}</p>;
  }

  const { workingGroup, member } = found;
  return (
    <MemberDetail
      member={member}
      workingGroupName={workingGroup.name}
      // For convenience only: the API decides, and a refusal shows its text.
      canRemove={mayRemoveMember(me, workingGroup, member.isCoordinator, { now: new Date() })}
      pending={remove.isPending}
      error={remove.isError ? apiErrorMessage(apiErrorCode(remove.error)) : undefined}
      onRemove={() =>
        remove.mutate(
          { membershipId },
          {
            onSuccess: () =>
              void navigate(listPath, {
                state: {
                  message: `${nameInSentence(member.name)} is verwijderd uit ${workingGroup.name}.`,
                } satisfies FlashState,
              }),
          },
        )
      }
    />
  );
}
