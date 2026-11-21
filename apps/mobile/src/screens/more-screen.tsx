import { healthQueryOptions, useHealthLiveUpdates } from "@padvinder/api-client";
import { HealthStatus } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";
import { APP_BUILD, APP_VERSION } from "../app-version";

export function MoreScreen() {
  const { data, isError } = useQuery(healthQueryOptions());
  useHealthLiveUpdates();
  return (
    <section className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Meer</h1>
      <HealthStatus health={data} loadFailed={isError} />
      <p className="text-muted-foreground mt-4 text-sm">
        App-versie {APP_VERSION} ({APP_BUILD})
      </p>
    </section>
  );
}
