import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { getMeQueryKey } from "./generated/@tanstack/react-query.gen";

/**
 * The generated client rejects with the parsed response body, so a 401 shows as the stable error
 * code `not_logged_in` (the same body `meQueryOptions` turns into `null`).
 */
function isNotLoggedIn(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { code?: unknown }).code === "not_logged_in" ||
      (error as { statusCode?: unknown }).statusCode === 401)
  );
}

/**
 * The generated client uses `baseUrl: ""`, so requests go to the same origin as the page.
 * Any query or mutation that fails with a 401 makes the app ask `/api/me` again, so an ended
 * session leads to the login screen. The me query itself is left alone: it resolves a 401 to `null`.
 */
export function createQueryClient(): QueryClient {
  const meKey = getMeQueryKey();
  const refetchMe = () => void client.invalidateQueries({ queryKey: meKey });
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (
          isNotLoggedIn(error) &&
          (query.queryKey[0] as { _id?: string } | undefined)?._id !== meKey[0]._id
        )
          refetchMe();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isNotLoggedIn(error)) refetchMe();
      },
    }),
  });
  return client;
}
