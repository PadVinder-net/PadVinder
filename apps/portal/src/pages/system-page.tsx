import { healthQueryOptions, useHealthLiveUpdates, useMe } from "@padvinder/api-client";
import { HealthStatus } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

/** Only mounted for platform admins, so nobody else fetches or streams the status. */
function SystemStatus() {
  const { data, isError } = useQuery(healthQueryOptions());
  useHealthLiveUpdates();
  return <HealthStatus health={data} loadFailed={isError} />;
}

export function SystemPage() {
  const me = useMe();
  if (!me.data) return null;
  if (!me.data.user.isPlatformAdmin) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <p>Je hebt geen toegang tot deze pagina.</p>
        <Link to="/" className="mt-4 block underline">
          Terug
        </Link>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-bold">Systeemstatus</h1>
      <SystemStatus />
    </main>
  );
}
