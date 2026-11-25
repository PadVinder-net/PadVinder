import swagger from "@fastify/swagger";
import type { Db, QueueMail } from "@padvinder/db";
import Fastify, { type FastifyInstance } from "fastify";
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
import { eventsRoutes, SESSION_RECHECK_MS } from "./routes/events";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { membershipRequestRoutes } from "./routes/membership-requests";
import { membershipRoutes } from "./routes/memberships";
import { organizationRoutes } from "./routes/organizations";
import { speciesRoutes } from "./routes/species";
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
  /** Turns on Fastify's request logging at `env.LOG_LEVEL`. Off by default (tests). */
  logger?: boolean;
  /** Where the log goes instead of stdout, when `logger` is on (tests that read the log). */
  logStream?: { write(line: string): void };
  /** How often an open event stream checks its session; default `SESSION_RECHECK_MS`. Tests. */
  sessionRecheckMs?: number;
};

declare module "fastify" {
  interface FastifyInstance {
    auth: Auth;
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
    logger: deps.logger
      ? { level: env.LOG_LEVEL, ...(deps.logStream && { stream: deps.logStream }) }
      : false,
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
      await api.register(authRoutes, { auth, origin: env.PUBLIC_ORIGIN });
      await api.register(healthRoutes, { env, db: deps.db });
      await api.register(versionRoutes, { env });
      await api.register(meRoutes, { db: deps.db });
      await api.register(workingGroupRoutes, { db: deps.db });
      await api.register(membershipRoutes, { db: deps.db });
      await api.register(organizationRoutes, { db: deps.db, queueMail: deps.queueMail });
      await api.register(speciesRoutes, { db: deps.db });
      await api.register(membershipRequestRoutes, {
        db: deps.db,
        mailer: deps.mailer,
        publicOrigin: env.PUBLIC_ORIGIN,
      });
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
