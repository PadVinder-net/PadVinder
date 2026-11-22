import { mayOpenMembers, useMe, type MeResponse } from "@padvinder/api-client";
import { MemberList } from "@padvinder/ui";
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
  // One list for all groups: rows open when the user may open members in at least one group.
  // In a group where they are a volunteer, the member screen then shows only the name.
  const canOpen = lists.groups.some(({ workingGroup }) => mayOpenMembers(me, workingGroup));
  return (
    <MemberList
      groups={lists.groups}
      onOpen={
        canOpen ? (membershipId) => void navigate(`/more/members/${membershipId}`) : undefined
      }
    />
  );
}
