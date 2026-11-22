import { healthQueryOptions, useHealthLiveUpdates, useLogOut } from "@padvinder/api-client";
import { Button, HealthStatus } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";

export function MoreScreen() {
  const { data, isError } = useQuery(healthQueryOptions());
  useHealthLiveUpdates();
  const { logOut, failed: logOutFailed } = useLogOut();

  return (
    <section className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Meer</h1>
      <HealthStatus health={data} loadFailed={isError} />
      {logOutFailed ? (
        <p role="alert" className="mt-6 text-base text-destructive">
          Uitloggen lukt nu niet. Controleer je verbinding en probeer het opnieuw.
        </p>
      ) : null}
      <Button
        size="lg"
        variant="outline"
        className="mt-6 h-14 w-full text-lg"
        onClick={() => void logOut()}
      >
        Log uit
      </Button>
    </section>
  );
}
