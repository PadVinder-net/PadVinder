import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addPlatformAdmin,
  deleteUser,
  findAccount,
  removePlatformAdmin,
  type AccountSummary,
} from "./generated";
import {
  listPlatformAdminsOptions,
  listPlatformAdminsQueryKey,
} from "./generated/@tanstack/react-query.gen";
import { refetchAdministration } from "./administration";
import { apiErrorCode } from "./error-messages";
import { refetchMe } from "./me-query";

/** The platform admins (platform admins only). */
export function usePlatformAdmins() {
  return useQuery(listPlatformAdminsOptions());
}

/** After a change, also after an error: the list and the user's own rights may be out of date. */
function useSettledAdmins() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: listPlatformAdminsQueryKey() }),
      refetchMe(queryClient),
    ]);
  };
}

/** Makes the account with this address a platform admin (it makes the account when there is none). */
export function useAddPlatformAdmin() {
  const onSettled = useSettledAdmins();
  return useMutation({
    mutationFn: async (email: string) => {
      const { data } = await addPlatformAdmin({ body: { email }, throwOnError: true });
      return data;
    },
    onSettled,
  });
}

/** Takes the platform admin role from a user. */
export function useRemovePlatformAdmin() {
  const onSettled = useSettledAdmins();
  return useMutation({
    mutationFn: async (userId: string) => {
      await removePlatformAdmin({ path: { userId }, throwOnError: true });
    },
    onSettled,
  });
}

/**
 * Looks up an account by its whole address: the account, or `null` when there is none (404). A
 * mutation, not a query, so the address stays out of the query cache. The address is sent in the
 * body.
 */
export function useFindAccount() {
  return useMutation({
    mutationFn: async (email: string): Promise<AccountSummary | null> => {
      try {
        const { data } = await findAccount({ body: { email }, throwOnError: true });
        return data;
      } catch (error) {
        if (apiErrorCode(error) === "not_found") return null;
        throw error;
      }
    },
  });
}

/**
 * Deletes someone else's account. A refusal throws the API's error body (`accountDeletionBlockers`
 * reads its blockers). The lists are refetched when it settles.
 */
export function useDeleteAccountOf() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await deleteUser({ path: { userId }, throwOnError: true });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: listPlatformAdminsQueryKey() }),
        refetchAdministration(queryClient),
      ]);
    },
  });
}
