import { healthQueryOptions, useHealthLiveUpdates } from "@padvinder/api-client";
import { HealthStatus } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";

/** Only mounted for platform admins (`RequirePlatformAdmin`), so nobody else fetches or streams the status. */
export function SystemPage() {
  const { data, isError } = useQuery(healthQueryOptions());
  useHealthLiveUpdates();
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Systeemstatus</h1>
      <HealthStatus health={data} loadFailed={isError} />
    </main>
  );
}
