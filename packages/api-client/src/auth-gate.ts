import { useQueryClient } from "@tanstack/react-query";
import { gateState, meLoadFailed, type GateState } from "./gate";
import { getMeQueryKey } from "./generated/@tanstack/react-query.gen";
import { clearOtherUserData, useMe, useUpdateMe } from "./me-query";

/** What the gate shows: loading, the retry screen, or `gateState` once `me` is known. */
export type AuthGateState = "loading" | "failed" | GateState;

/**
 * Everything the login gate of the mobile app and the portal needs, so both behave the same.
 * Render it with `AuthGateView` from `@padvinder/ui`.
 */
export function useAuthGate() {
  const queryClient = useQueryClient();
  const me = useMe();
  const updateMe = useUpdateMe();

  const state: AuthGateState = me.isPending
    ? "loading"
    : meLoadFailed(me)
      ? "failed"
      : gateState(me.data ?? null);

  return {
    state,
    retry: () => void me.refetch(),
    /**
     * After signing in, `me` starts over: the gate shows "loading", and if `/api/me` then fails it
     * shows the retry screen instead of the login screen (the session cookie is already set, and
     * the code is used up). Data of an earlier user on this device is dropped first.
     */
    onLoggedIn: () => {
      clearOtherUserData(queryClient);
      void queryClient.resetQueries({ queryKey: getMeQueryKey() });
    },
    saveName: {
      pending: updateMe.isPending,
      failed: updateMe.isError,
      submit: (values: { name: string; phone: string | null }) => updateMe.mutate(values),
    },
  };
}
