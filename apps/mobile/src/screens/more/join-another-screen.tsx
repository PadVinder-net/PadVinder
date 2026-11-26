import { listWorkingGroupsOptions, otherWorkingGroups, useMe } from "@padvinder/api-client";
import { Button, connectionMessage, WorkingGroupPicker } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useJoinWorkingGroup } from "../../lib/use-join-working-group";
import { Loading, SubScreen } from "./sub-screen";

/**
 * A member asks to join another working group: part 1's picker, without the groups they are in.
 * After the request is stored, the app goes back to Profiel, which shows the pending request.
 */
export function JoinAnotherScreen() {
  const me = useMe().data;
  const groups = useQuery(listWorkingGroupsOptions());
  const navigate = useNavigate();
  const { join, pending, error } = useJoinWorkingGroup({
    onGone: () => void groups.refetch(),
    onSuccess: () => void navigate("/more/profile"),
  });
  if (!me) return null;

  let body;
  if (groups.isPending) {
    body = <Loading>Werkgroepen laden…</Loading>;
  } else if (groups.isError) {
    body = (
      <div className="flex flex-col gap-4 text-lg">
        <p>{connectionMessage}</p>
        <Button size="lg" className="h-14 w-full text-lg" onClick={() => void groups.refetch()}>
          Probeer opnieuw
        </Button>
      </div>
    );
  } else {
    const available = otherWorkingGroups(me, groups.data.workingGroups);
    body =
      available.length === 0 ? (
        <p className="text-lg">Je bent al lid van alle werkgroepen.</p>
      ) : (
        <WorkingGroupPicker
          workingGroups={available}
          onJoin={join}
          pending={pending}
          error={error}
        />
      );
  }
  return <SubScreen back="/more/profile">{body}</SubScreen>;
}
