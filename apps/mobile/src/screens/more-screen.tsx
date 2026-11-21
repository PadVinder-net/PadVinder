import { healthQueryOptions, useHealthLiveUpdates } from "@padvinder/api-client";
import { HealthStatus } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";

export function MoreScreen() {
  const { data, isError } = useQuery(healthQueryOptions());
  useHealthLiveUpdates();
  return (
    <section className="p-4">
      <h1 className="mb-4 text-2xl font-bold">Meer</h1>
      <HealthStatus health={data} loadFailed={isError} />
    </section>
  );
}
