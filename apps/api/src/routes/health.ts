import {
  deriveOverallStatus,
  healthResponseSchema,
  type HealthResponse,
} from "@padvinder/contracts";
import { getDatabaseDiagnostics, getLatestHeartbeat, type Db } from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { ApiEnv } from "../env";

/** The whole database check answers within this time, also when the database hangs. */
const DATABASE_CHECK_TIMEOUT_MS = 3_000;

/** Rejects when `promise` has not settled after `ms`. The work itself is not cancelled. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoutes: FastifyPluginAsyncZod<{ env: ApiEnv; db: Db }> = async (
  app,
  { env, db },
) => {
  app.get(
    "/health",
    {
      schema: {
        operationId: "getHealth",
        summary: "Health of the API, the database and the worker",
        // The same body for both: a degraded system still reports what it knows.
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
      },
    },
    async (request, reply) => {
      const now = new Date();
      let database: HealthResponse["database"];
      let lastHeartbeat: Date | null;
      try {
        const [diagnostics, heartbeat] = await withTimeout(
          Promise.all([getDatabaseDiagnostics(db), getLatestHeartbeat(db)]),
          DATABASE_CHECK_TIMEOUT_MS,
        );
        database = {
          reachable: true,
          postgresVersion: diagnostics.postgresVersion,
          postgisVersion: diagnostics.postgisVersion,
          latestMigration: diagnostics.latestMigration && {
            name: diagnostics.latestMigration.name,
            createdAt: diagnostics.latestMigration.createdAt.toISOString(),
          },
        };
        lastHeartbeat = heartbeat;
      } catch (error) {
        // Connect timeout, statement timeout, query error or no answer: report it, never throw.
        request.log.warn({ err: error }, "Health check could not reach the database");
        database = {
          reachable: false,
          postgresVersion: null,
          postgisVersion: null,
          latestMigration: null,
        };
        lastHeartbeat = null;
      }

      const status = deriveOverallStatus({
        databaseReachable: database.reachable,
        lastHeartbeatAt: lastHeartbeat,
        now,
      });
      return reply.code(status === "ok" ? 200 : 503).send({
        status,
        commit: env.GIT_COMMIT,
        checkedAt: now.toISOString(),
        database,
        worker: { lastHeartbeatAt: lastHeartbeat?.toISOString() ?? null },
      });
    },
  );
};
