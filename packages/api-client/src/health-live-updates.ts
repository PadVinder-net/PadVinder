import {
  deriveOverallStatus,
  type HealthResponse,
  type WorkerHeartbeatEvent,
} from "@padvinder/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getHealthQueryKey } from "./generated/@tanstack/react-query.gen";
import { refetchMe } from "./query-client";
import { subscribeToServerEvents } from "./server-events";

/**
 * Applies a worker heartbeat to cached health. An event older than the cached heartbeat
 * (out of order) changes nothing. The status is recomputed from the cached database state.
 */
export function applyWorkerHeartbeat(
  health: HealthResponse,
  event: WorkerHeartbeatEvent,
  now: Date,
): HealthResponse {
  const beatAt = new Date(event.beatAt);
  const cached = health.worker.lastHeartbeatAt;
  if (cached !== null && beatAt < new Date(cached)) return health;
  return {
    ...health,
    status: deriveOverallStatus({
      databaseReachable: health.database.reachable,
      lastHeartbeatAt: beatAt,
      now,
    }),
    worker: { lastHeartbeatAt: event.beatAt },
  };
}

/**
 * Keeps the cached health up to date from the event stream. Events sent while the connection
 * was down are lost, so every (re)open also refetches the health. A stream the server refuses
 * (a 401 after logging out elsewhere) asks `/api/me` again, which leads to the login screen.
 */
export function useHealthLiveUpdates(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      subscribeToServerEvents({
        onOpen: () => {
          void queryClient.invalidateQueries({ queryKey: getHealthQueryKey() });
        },
        onClosed: () => refetchMe(queryClient),
        events: {
          "worker-heartbeat": (event) => {
            // Returning undefined when nothing is cached leaves the cache empty.
            queryClient.setQueryData<HealthResponse>(
              getHealthQueryKey(),
              (health) => health && applyWorkerHeartbeat(health, event, new Date()),
            );
          },
        },
      }),
    [queryClient],
  );
}
