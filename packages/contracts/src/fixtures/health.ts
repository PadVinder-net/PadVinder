import type { HealthResponse } from "../health";

const database: HealthResponse["database"] = {
  reachable: true,
  detailsHidden: false,
  postgresVersion: "18.7",
  postgisVersion: "3.6.2",
  latestMigration: { name: "0001_worker_heartbeats", createdAt: "2026-11-21T10:00:00.000Z" },
};

export const healthyFixture: HealthResponse = {
  status: "ok",
  commit: "0123456789abcdef",
  checkedAt: "2027-03-01T19:31:00.000Z",
  database,
  worker: { lastHeartbeatAt: "2027-03-01T19:30:00.000Z" },
};

export const workerStaleFixture: HealthResponse = {
  ...healthyFixture,
  status: "degraded",
  worker: { lastHeartbeatAt: "2027-03-01T19:20:00.000Z" },
};

export const databaseUnreachableFixture: HealthResponse = {
  ...healthyFixture,
  status: "degraded",
  database: {
    reachable: false,
    detailsHidden: true,
    postgresVersion: null,
    postgisVersion: null,
    latestMigration: null,
  },
  worker: { lastHeartbeatAt: null },
};

/** What nobody and every non-admin gets: the status, without the database details. */
export const detailsHiddenFixture: HealthResponse = {
  ...healthyFixture,
  database: {
    reachable: true,
    detailsHidden: true,
    postgresVersion: null,
    postgisVersion: null,
    latestMigration: null,
  },
};
