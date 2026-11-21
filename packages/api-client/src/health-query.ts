import { healthResponseSchema } from "@padvinder/contracts";
import { queryOptions } from "@tanstack/react-query";
import { getHealth, type GetHealthResponse } from "./generated";
import { getHealthQueryKey } from "./generated/@tanstack/react-query.gen";

/**
 * Like the generated `getHealthOptions()`, but a 503 with a health body resolves as data:
 * the health screen must show what a degraded system reports. Same query key.
 * Any other failure (network, 500, a 503 from a proxy without our body) still rejects.
 */
export function healthQueryOptions() {
  return queryOptions({
    queryKey: getHealthQueryKey(),
    // Server events report new heartbeats but not missing ones: refetch, so the status turns
    // degraded on an open page when the worker stops.
    refetchInterval: 60_000,
    queryFn: async ({ signal }): Promise<GetHealthResponse> => {
      const { data, error, response } = await getHealth({ signal });
      if (data) return data;
      const degraded = healthResponseSchema.safeParse(error);
      // `response` is missing when the request never completed (offline).
      const status: number | undefined = response?.status;
      if (status === 503 && degraded.success) return degraded.data;
      throw error ?? new Error(`Health request failed with status ${status}`);
    },
  });
}
