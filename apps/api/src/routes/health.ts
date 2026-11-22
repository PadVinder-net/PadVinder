import {
  deriveOverallStatus,
  healthResponseSchema,
  type HealthResponse,
} from "@padvinder/contracts";
import { getDatabaseDiagnostics, getLatestHeartbeat, type Db } from "@padvinder/db";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { ApiEnv } from "../env";
import { loadActor } from "../permissions/actor";
import { decide } from "../permissions/rules";

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
  /** The actor, or `null` for no login. A failure counts as "no actor": the endpoint must answer. */
  async function loadActorOrNull(request: FastifyRequest) {
    try {
      return await withTimeout(loadActor(app, db, request), DATABASE_CHECK_TIMEOUT_MS);
    } catch (error) {
      request.log.warn({ err: error }, "Health check could not load the actor");
      return null;
    }
  }

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
      // Outside the database check's own timeout: a slow actor load means "no actor", it must
      // not make the database look unreachable. It never rejects.
      const actorLoad = loadActorOrNull(request);
      try {
        const [diagnostics, heartbeat] = await withTimeout(
          Promise.all([getDatabaseDiagnostics(db), getLatestHeartbeat(db)]),
          DATABASE_CHECK_TIMEOUT_MS,
        );
        const actor = await actorLoad;
        const showDetails =
          actor !== null && decide(actor, { action: "system.viewDatabaseDetails" }) === "allowed";
        database = showDetails
          ? {
              reachable: true,
              detailsHidden: false,
              postgresVersion: diagnostics.postgresVersion,
              postgisVersion: diagnostics.postgisVersion,
              latestMigration: diagnostics.latestMigration && {
                name: diagnostics.latestMigration.name,
                createdAt: diagnostics.latestMigration.createdAt.toISOString(),
              },
            }
          : {
              reachable: true,
              detailsHidden: true,
              postgresVersion: null,
              postgisVersion: null,
              latestMigration: null,
            };
        lastHeartbeat = heartbeat;
      } catch (error) {
        // Connect timeout, statement timeout, query error or no answer: report it, never throw.
        request.log.warn({ err: error }, "Health check could not reach the database");
        database = {
          reachable: false,
          detailsHidden: true,
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
