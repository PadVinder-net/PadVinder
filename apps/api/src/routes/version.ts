import { versionResponseSchema } from "@padvinder/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { ApiEnv } from "../env";

export const versionRoutes: FastifyPluginAsyncZod<{ env: ApiEnv }> = async (app, { env }) => {
  app.get(
    "/version",
    {
      schema: {
        operationId: "getVersion",
        summary: "Minimum app version and server commit",
        response: { 200: versionResponseSchema },
      },
    },
    async () => ({ minimumAppVersion: env.MIN_APP_VERSION, commit: env.GIT_COMMIT }),
  );
};
