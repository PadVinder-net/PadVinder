import { mayOpenMembers, useMe, type MeResponse } from "@padvinder/api-client";
import { apiErrorMessage, MemberList } from "@padvinder/ui";
import { useNavigate } from "react-router";
import { FlashMessage, LoadError, Loading, SubScreen } from "./sub-screen";
import { useMemberLists } from "./working-group-lists";

/** The members of the user's groups, per group. Coordinators and admins can open a member. */
export function MembersScreen() {
  const me = useMe().data;
  if (!me) return null;
  return (
    <SubScreen back="/more">
      <FlashMessage />
      <Members me={me} />
    </SubScreen>
  );
}

function Members({ me }: { me: MeResponse }) {
  const navigate = useNavigate();
  const lists = useMemberLists(me);
  if (lists.error) return <LoadError error={lists.error} onRetry={lists.refetch} />;
  if (lists.isPending) return <Loading>Leden laden…</Loading>;
  // No group to list: the menu hides Leden, and a URL typed by hand gets the API's "no".
  if (lists.groups.length === 0) return <p className="text-lg">{apiErrorMessage("not_allowed")}</p>;
  const openable = new Set(
    lists.groups
      .filter(({ workingGroup }) => mayOpenMembers(me, workingGroup, { now: new Date() }))
      .map(({ workingGroup }) => workingGroup.id),
  );
  return (
    <MemberList
      groups={lists.groups}
      onOpen={(membershipId) => void navigate(`/more/members/${membershipId}`)}
      // Only coordinators and admins of a group open its members; elsewhere the rows are plain.
      canOpen={(workingGroupId) => openable.has(workingGroupId)}
    />
  );
}
