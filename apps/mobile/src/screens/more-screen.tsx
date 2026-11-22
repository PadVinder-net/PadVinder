import {
  getMeQueryKey,
  healthQueryOptions,
  logOut,
  useHealthLiveUpdates,
} from "@padvinder/api-client";
import { Button, HealthStatus } from "@padvinder/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function MoreScreen() {
  const { data, isError } = useQuery(healthQueryOptions());
  useHealthLiveUpdates();
  const queryClient = useQueryClient();

  async function handleLogOut() {
    await logOut();
    // "Not logged in" is the answer for me; the gate watches that query, so it is kept (cleared
    // observers would never hear of a new one). Nothing else of the previous user stays in memory.
    const meKey = getMeQueryKey();
    queryClient.setQueryData(meKey, null);
    queryClient.removeQueries({
      predicate: (query) => (query.queryKey[0] as { _id?: string })._id !== meKey[0]._id,
    });
    queryClient.getMutationCache().clear();
  }

  return (
    <section className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Meer</h1>
      <HealthStatus health={data} loadFailed={isError} />
      <Button
        size="lg"
        variant="outline"
        className="mt-6 h-14 w-full text-lg"
        onClick={() => void handleLogOut()}
      >
        Log uit
      </Button>
    </section>
  );
}
