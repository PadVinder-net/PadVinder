import {
  apiErrorMessage,
  healthQueryOptions,
  useHealthLiveUpdates,
  useMe,
} from "@padvinder/api-client";
import { HealthStatus } from "@padvinder/ui";
import { useQuery } from "@tanstack/react-query";
import { SubScreen } from "./sub-screen";

/** Only mounted for platform admins, so nobody else fetches or streams the status. */
function SystemStatus() {
  const { data, isError } = useQuery(healthQueryOptions());
  useHealthLiveUpdates();
  return <HealthStatus health={data} loadFailed={isError} />;
}

export function SystemScreen() {
  const me = useMe().data;
  if (!me) return null;
  return (
    <SubScreen back="/more">
      {me.user.isPlatformAdmin ? (
        <SystemStatus />
      ) : (
        <p className="text-lg">{apiErrorMessage("not_allowed")}</p>
      )}
    </SubScreen>
  );
}
