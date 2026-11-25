import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { refetchAdministration } from "./administration";
import { refetchMembershipRequests } from "./membership";
import { refetchMe } from "./me-query";
import { subscribeToServerEvents } from "./server-events";

/**
 * Keeps me and the membership requests up to date from the event stream. Mount it once while
 * someone is logged in.
 *
 * - `access-changed` refetches me, so the waiting screen turns into the tabs without a reload. The
 *   server sends it only to the user it is about (not even to platform admins).
 * - `membership-requests-changed` refetches the requests of that working group.
 * - Both also refetch the administration lists (managed working groups, organizations, member
 *   counts), which the portal pages show.
 * - Every (re)open refetches all of them, because events sent while the connection was down are lost.
 * - When the server refuses the stream (a 401 after logging out elsewhere, a proxy's 502 during a
 *   deploy), me is refetched: if it is `null`, the gate shows the login screen and unmounts this
 *   hook, which closes the stream. Otherwise `subscribeToServerEvents` opens it again after a
 *   pause.
 *
 * `useHealthLiveUpdates` opens its own stream, so a platform admin on the system status screen has
 * two connections for as long as that screen is open.
 */
export function useAccessLiveUpdates(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      subscribeToServerEvents({
        onOpen: () => {
          refetchMe(queryClient);
          refetchMembershipRequests(queryClient);
          refetchAdministration(queryClient);
        },
        onClosed: () => refetchMe(queryClient),
        events: {
          "access-changed": () => {
            refetchMe(queryClient);
            refetchAdministration(queryClient);
          },
          "membership-requests-changed": (event) => {
            refetchMembershipRequests(queryClient, event.workingGroupId);
            refetchAdministration(queryClient);
          },
        },
      }),
    [queryClient],
  );
}
