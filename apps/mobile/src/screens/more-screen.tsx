import { healthQueryOptions, useHealthLiveUpdates, useLogOut, useMe } from "@padvinder/api-client";
import { Button, HealthStatus } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";
import { APP_BUILD, APP_VERSION } from "../app-version";

/** Only mounted for platform admins, so nobody else fetches or streams the status. */
function SystemStatus() {
  const { data, isError } = useQuery(healthQueryOptions());
  useHealthLiveUpdates();
  return <HealthStatus health={data} loadFailed={isError} />;
}

export function MoreScreen() {
  const me = useMe();
  const { logOut, failed: logOutFailed } = useLogOut();

  return (
    <section className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Meer</h1>
      {me.data?.user.isPlatformAdmin ? <SystemStatus /> : null}
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
      <p className="text-muted-foreground mt-4 text-sm">
        App-versie {APP_VERSION} ({APP_BUILD})
      </p>
    </section>
  );
}
