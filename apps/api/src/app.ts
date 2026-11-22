import swagger from "@fastify/swagger";
import type { Db } from "@padvinder/db";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { ApiEnv } from "./env";
import { addErrorHandling } from "./errors";
import { addOriginCheck } from "./plugins/origin-check";
import { registerStaticApps } from "./plugins/static-apps";
import type { NotificationHub } from "./realtime/notification-hub";
import { eventsRoutes } from "./routes/events";
import { healthRoutes } from "./routes/health";
import { versionRoutes } from "./routes/version";

export type AppDeps = {
  env: ApiEnv;
  db: Db;
  notifications: NotificationHub;
  /** Turns on Fastify's request logging at `env.LOG_LEVEL`. Off by default (tests). */
  logger?: boolean;
};

/**
 * Builds the Fastify app without starting it and without connecting to the database:
 * `db` is a lazy pool, so OpenAPI generation can pass one that never connects.
 * There is no CORS plugin: only our own pages call the API (same origin).
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;
  const app = Fastify({ logger: deps.logger ? { level: env.LOG_LEVEL } : false });

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

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { env, db: deps.db });
      await api.register(versionRoutes, { env });
      await api.register(eventsRoutes, { notifications: deps.notifications });
    },
    { prefix: "/api" },
  );

  await registerStaticApps(app, { mobileDir: env.MOBILE_DIST_DIR, portalDir: env.PORTAL_DIST_DIR });

  return app;
}
