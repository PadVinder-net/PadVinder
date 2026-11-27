import { MutationCache, QueryCache, QueryClient, type Query } from "@tanstack/react-query";
import { getMeQueryKey } from "./generated/@tanstack/react-query.gen";
import { apiErrorCode } from "./error-messages";
import { clearOtherUserData } from "./me-query";
import { cancelPasskeyConfirmation, reportPasskeyRequired } from "./passkey-confirmation";

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

const isPasskeyRequired = (error: unknown) => apiErrorCode(error) === "passkey_required";

/** TanStack Query's default of three retries, but none for what only a confirmation solves. */
function retry(failureCount: number, error: unknown): boolean {
  return !isPasskeyRequired(error) && failureCount < 3;
}

/**
 * TanStack Query's default refetch on window focus, but not for a query that waits for a passkey
 * confirmation: after Annuleer it keeps its error until the person asks again (an explicit
 * `refetch`, which opens the modal again).
 */
function refetchOnWindowFocus(query: Query): boolean {
  return !isPasskeyRequired(query.state.error);
}

/**
 * The generated client uses `baseUrl: ""`, so requests go to the same origin as the page.
 * Any query or mutation that fails with a 401 makes the app ask `/api/me` again, so an ended
 * session leads to the login screen. The me query itself is left alone: it resolves a 401 to `null`.
 * When it does, the data of the user whose session ended is dropped (`clearOtherUserData`).
 * A query or mutation that fails with `passkey_required` is not retried and opens the passkey
 * confirmation (`usePasskeyConfirmation`), unless its `meta` is `backgroundRequestMeta`. Such a
 * query is not refetched on window focus either.
 */
export function createQueryClient(): QueryClient {
  const meKey = getMeQueryKey();
  const isMe = (queryKey: readonly unknown[]) =>
    (queryKey[0] as { _id?: string } | undefined)?._id === meKey[0]._id;
  const refetchMe = () => void client.invalidateQueries({ queryKey: meKey });
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onSuccess: (data, query) => {
        if (data !== null || !isMe(query.queryKey)) return;
        clearOtherUserData(client);
        cancelPasskeyConfirmation(client);
      },
      onError: (error, query) => {
        if (isNotLoggedIn(error) && !isMe(query.queryKey)) refetchMe();
        if (isPasskeyRequired(error)) reportPasskeyRequired(client, { query });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _onMutateResult, mutation) => {
        if (isNotLoggedIn(error)) refetchMe();
        if (isPasskeyRequired(error)) reportPasskeyRequired(client, { mutation });
      },
    }),
    defaultOptions: { queries: { retry, refetchOnWindowFocus } },
  });
  return client;
}
