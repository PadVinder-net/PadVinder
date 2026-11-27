import swagger from "@fastify/swagger";
import type { Db, QueueMail } from "@padvinder/db";
import type { Logger } from "@padvinder/logging";
import type { MonitoringSettings } from "@padvinder/monitoring";
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { createAuth, type Auth } from "./auth/auth";
import { authRoutes } from "./auth/auth-routes";
import { addActorLoading } from "./permissions/actor";
import type { ApiEnv } from "./env";
import { addErrorHandling } from "./errors";
import type { Mailer } from "@padvinder/mail";
import { addOriginCheck } from "./plugins/origin-check";
import { registerStaticApps } from "./plugins/static-apps";
import type { NotificationHub } from "./realtime/notification-hub";
import { auditLogRoutes } from "./routes/audit-log";
import { eventsRoutes, SESSION_RECHECK_MS } from "./routes/events";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { membershipRequestRoutes } from "./routes/membership-requests";
import { membershipRoutes } from "./routes/memberships";
import { organizationRoutes } from "./routes/organizations";
import { passkeyRoutes } from "./routes/passkeys";
import { platformAdminRoutes } from "./routes/platform-admins";
import { problemReportRoutes } from "./routes/problem-reports";
import { speciesRoutes } from "./routes/species";
import { sentryTunnelRoutes } from "./routes/sentry-tunnel";
import { systemRoutes } from "./routes/system";
import { userRoutes } from "./routes/users";
import { workingGroupRoutes } from "./routes/working-groups";
import { versionRoutes } from "./routes/version";

export type AppDeps = {
  env: ApiEnv;
  db: Db;
  notifications: NotificationHub;
  /** Sends the login code mails and the mails about requests. Tests pass the memory mailer. */
  mailer: Mailer;
  /**
   * Queues the mails the worker sends (appointments), in the transaction of the change. Tests
   * pass the memory queue.
   */
  queueMail: QueueMail;
  /** The logger of the app and its requests. Absent means no logging (most tests). */
  logger?: Logger;
  /**
   * Sentry's settings, for the tunnel that forwards the browser's envelopes and for problem
   * reports. Absent means Sentry is off: the tunnel drops envelopes, and a report is only logged.
   */
  monitoring?: MonitoringSettings;
  /** How often an open event stream checks its session; default `SESSION_RECHECK_MS`. Tests. */
  sessionRecheckMs?: number;
};

declare module "fastify" {
  interface FastifyInstance {
    auth: Auth;
  }
}

/**
 * One log line per request instead of Fastify's two ("incoming request" and "request
 * completed"): the completed line carries the request too. Fastify's other request logs (a
 * failing serializer, a stream error) stay. The line goes through `reply.log`, which follows a
 * route's `logLevel`, so `/api/health` (at `warn`) stays out of the log.
 */
class OneLinePerRequest extends LogController {
  override incomingRequest(): void {}

  override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    if (this.isLogDisabled(request)) return;
    const fields = { req: request, res: reply, responseTime: reply.elapsedTime };
    if (error) reply.log.error({ ...fields, err: error }, "request errored");
    else reply.log.info(fields, "request completed");
  }
}

/**
 * Builds the Fastify app without starting it and without connecting to the database:
 * `db` is a lazy pool, so OpenAPI generation can pass one that never connects.
 * There is no CORS plugin: only our own pages call the API (same origin).
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;
  const app = Fastify({
    ...(deps.logger ? { loggerInstance: deps.logger as FastifyBaseLogger } : { logger: false }),
    logController: new OneLinePerRequest(),
  });

  // Zod schemas validate requests and serialize responses (also for 503).
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Must be registered before the routes, so it sees them. Schemas with `.meta({ id })`
  // become named components.
  await app.register(swagger, {
    openapi: { info: { title: "PadVinder API", version: env.GIT_COMMIT } },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  addErrorHandling(app);
  addOriginCheck(app, env.ALLOWED_ORIGINS);

  const auth = createAuth({ env, db: deps.db, mailer: deps.mailer, log: app.log });
  app.decorate("auth", auth);
  addActorLoading(app, deps.db);

  await app.register(
    async (api) => {
      await api.register(authRoutes, {
        auth,
        origin: env.PUBLIC_ORIGIN,
        db: deps.db,
        queueMail: deps.queueMail,
      });
      await api.register(healthRoutes, { env, db: deps.db });
      await api.register(versionRoutes, { env });
      await api.register(meRoutes, { db: deps.db });
      await api.register(workingGroupRoutes, {
        db: deps.db,
        mailer: deps.mailer,
        queueMail: deps.queueMail,
        publicOrigin: env.PUBLIC_ORIGIN,
      });
      await api.register(membershipRoutes, { db: deps.db });
      await api.register(organizationRoutes, { db: deps.db, queueMail: deps.queueMail });
      await api.register(platformAdminRoutes, { db: deps.db });
      await api.register(passkeyRoutes, { db: deps.db, queueMail: deps.queueMail });
      await api.register(userRoutes, { db: deps.db });
      await api.register(speciesRoutes, { db: deps.db });
      await api.register(auditLogRoutes, { db: deps.db });
      await api.register(systemRoutes, { db: deps.db });
      await api.register(membershipRequestRoutes, {
        db: deps.db,
        mailer: deps.mailer,
        publicOrigin: env.PUBLIC_ORIGIN,
      });
      await api.register(sentryTunnelRoutes, { monitoring: deps.monitoring });
      await api.register(problemReportRoutes, { monitoring: deps.monitoring });
      await api.register(eventsRoutes, {
        db: deps.db,
        notifications: deps.notifications,
        sessionRecheckMs: deps.sessionRecheckMs ?? SESSION_RECHECK_MS,
      });
    },
    { prefix: "/api" },
  );

  await registerStaticApps(app, { mobileDir: env.MOBILE_DIST_DIR, portalDir: env.PORTAL_DIST_DIR });

  return app;
}
