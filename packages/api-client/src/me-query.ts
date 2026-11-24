import { useState } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  matchMutation,
  useQueryClient,
  type MutationKey,
  type QueryClient,
} from "@tanstack/react-query";
import { getMe, updateMe, type GetMeResponse, type UpdateMeData } from "./generated";
import { logOut } from "./auth-client";
import { getMeQueryKey } from "./generated/@tanstack/react-query.gen";

/**
 * Like the generated `getMeOptions()`, but a 401 resolves to `null`: not logged in is data, not an
 * error, so nothing retries it. Same query key. Any other failure rejects.
 */
export function meQueryOptions() {
  return queryOptions({
    queryKey: getMeQueryKey(),
    queryFn: async ({ signal }): Promise<GetMeResponse | null> => {
      const { data, error, response } = await getMe({ signal });
      if (data) return data;
      // `response` is missing when the request never completed (offline).
      const status: number | undefined = response?.status;
      if (status === 401) return null;
      throw error ?? new Error(`Me request failed with status ${status}`);
    },
  });
}

/**
 * Drops every cached query except `me`, and every mutation: what the previous user saw must not
 * show for the next one on the same device. Called on logging out, on logging in, and when the
 * me query finds the session gone (`createQueryClient`). `me` stays because the gate watches it.
 * With `keepMutation` (after deleting the account) the mutations with that key stay: the gate
 * reads the finished deletion from them. Every other mutation goes, since its variables may hold a
 * name or a phone number.
 */
export function clearOtherUserData(
  queryClient: QueryClient,
  { keepMutation }: { keepMutation?: MutationKey } = {},
): void {
  const meId = getMeQueryKey()[0]._id;
  queryClient.removeQueries({
    predicate: (query) => (query.queryKey[0] as { _id?: string } | undefined)?._id !== meId,
  });
  const mutations = queryClient.getMutationCache();
  if (keepMutation === undefined) {
    mutations.clear();
    return;
  }
  for (const mutation of mutations.getAll()) {
    if (!matchMutation({ mutationKey: keepMutation }, mutation)) mutations.remove(mutation);
  }
}

/** Asks `/api/me` again: after a change to the user's access, or when the stream was refused. */
export function refetchMe(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
}

export function useMe() {
  return useQuery(meQueryOptions());
}

/** Saves the profile and puts the answer into the me cache. */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateMeData["body"]) => {
      const { data, error } = await updateMe({ body });
      if (data) return data;
      throw error ?? new Error("Profile update failed");
    },
    onSuccess: (data) => queryClient.setQueryData(getMeQueryKey(), data),
  });
}

/**
 * Logs out. If signing out fails the cookie may still be valid: then the user stays logged in and
 * `failed` is true. If the session is already gone, we continue as logged out. On success `me`
 * becomes `null` (the gate watches that query, so it is kept) and every other query and mutation
 * of the previous user is dropped.
 */
export function useLogOut() {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);

  async function handleLogOut() {
    setFailed(false);
    const result = await logOut();
    if (!result.ok) {
      // The session may already be over (ended on another device): ask the server who we are.
      const me = await queryClient
        .fetchQuery({ ...meQueryOptions(), staleTime: 0 })
        .catch(() => undefined);
      if (me !== null) {
        setFailed(true);
        return;
      }
    }
    queryClient.setQueryData(getMeQueryKey(), null);
    clearOtherUserData(queryClient);
  }

  return { logOut: handleLogOut, failed };
}
