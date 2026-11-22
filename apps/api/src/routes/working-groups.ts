import { workingGroupDirectoryResponseSchema } from "@padvinder/contracts";
import type { WorkingGroupDirectoryResponse } from "@padvinder/contracts";
import { listWorkingGroupDirectory, type Db } from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponses } from "../errors";

export const workingGroupRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // Every logged-in user may list the working groups, so there is no `authorize` call. This is
  // the one list that crosses organizations: a new volunteer picks a group from it.
  app.get(
    "/working-groups",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listWorkingGroups",
        summary: "The active working groups of all organizations",
        response: { 200: workingGroupDirectoryResponseSchema, ...errorResponses(401) },
      },
    },
    async (): Promise<WorkingGroupDirectoryResponse> => ({
      workingGroups: await listWorkingGroupDirectory(db),
    }),
  );
};
