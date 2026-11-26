import { useEffect } from "react";
import { setBrowserMonitoringUser } from "./browser-monitoring";

/**
 * Keeps Sentry's user in step with `/api/me`: the account's ID while someone is logged in, none
 * after logging out (`null`). `undefined` (me is loading, or failed without an earlier answer)
 * changes nothing.
 */
export function useBrowserMonitoringUser(userId: string | null | undefined): void {
  useEffect(() => {
    if (userId !== undefined) setBrowserMonitoringUser(userId);
  }, [userId]);
}
