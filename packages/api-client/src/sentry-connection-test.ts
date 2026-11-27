import { useMutation } from "@tanstack/react-query";
import { testSentryConnection, type SentryConnectionTestResponse } from "./generated";

/**
 * Sends a test event to Sentry over IPv4 and over IPv6 (Systeemstatus, platform admins). Resolves
 * with both results, or `sentryOff` when the server has no `SENTRY_DSN`; throws the API's error
 * body. No retry: the admin presses again.
 */
export function useTestSentryConnection() {
  return useMutation({
    mutationFn: async (): Promise<SentryConnectionTestResponse> => {
      const { data } = await testSentryConnection({ throwOnError: true });
      return data;
    },
  });
}
