import { useMe, type MeResponse } from "@padvinder/api-client";
import { apiErrorMessage, MembershipRequestList } from "@padvinder/ui";
import { useNavigate } from "react-router";
import { FlashMessage, LoadError, Loading, SubScreen } from "./sub-screen";
import { useRequestLists } from "./working-group-lists";

/** The open requests of the user's groups, per group. */
export function MembershipRequestsScreen() {
  const me = useMe().data;
  if (!me) return null;
  return (
    <SubScreen back="/more">
      <FlashMessage />
      <Requests me={me} />
    </SubScreen>
  );
}

function Requests({ me }: { me: MeResponse }) {
  const navigate = useNavigate();
  const lists = useRequestLists(me);
  if (lists.error) return <LoadError error={lists.error} onRetry={lists.refetch} />;
  if (lists.isPending) return <Loading>Aanmeldingen laden…</Loading>;
  // No group to review: the menu hides Aanmeldingen, and a URL typed by hand gets the API's "no".
  if (lists.groups.length === 0) return <p className="text-lg">{apiErrorMessage("not_allowed")}</p>;
  return (
    <MembershipRequestList
      groups={lists.groups}
      onOpen={(requestId) => void navigate(`/more/membership-requests/${requestId}`)}
    />
  );
}
