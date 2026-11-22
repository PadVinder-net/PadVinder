import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe, updateMe, type GetMeResponse, type UpdateMeData } from "./generated";
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
