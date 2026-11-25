import {
  apiErrorCodes,
  createSpeciesRequestSchema,
  speciesListResponseSchema,
  speciesSchema,
  updateSpeciesRequestSchema,
  type Species,
  type SpeciesListResponse,
} from "@padvinder/contracts";
import {
  createSpecies,
  listSpecies,
  updateSpecies,
  type Db,
  type SpeciesNameField,
  type SpeciesRecord,
} from "@padvinder/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiError, errorResponses } from "../errors";
import { authorize } from "../permissions/rules";

const speciesParamsSchema = z.object({ speciesId: z.uuid() });

const toSpecies = (record: SpeciesRecord): Species => ({
  id: record.id,
  dutchName: record.dutchName,
  scientificName: record.scientificName,
  needsVerification: record.needsVerification,
  active: record.active,
});

/** 409 `name_taken`, with the field whose name another species has. */
function nameTaken(field: SpeciesNameField) {
  return apiError(409, apiErrorCodes.nameTaken, "Another species has this name", [
    { path: field, message: "Another species has this name, in any capitals" },
  ]);
}

/**
 * The official species list. Every logged-in user reads it (it is not secret); only a platform
 * admin adds or changes a species. There is no delete: a species is switched off with `active`.
 */
export const speciesRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/species",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "listSpecies",
        summary: "All species, switched off or not, in Dutch order of the Dutch name",
        response: { 200: speciesListResponseSchema, ...errorResponses(401) },
      },
    },
    async (): Promise<SpeciesListResponse> => ({
      species: (await listSpecies(db)).map(toSpecies),
    }),
  );

  app.post(
    "/species",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "createSpecies",
        summary: "Add a species (platform admins)",
        body: createSpeciesRequestSchema,
        response: { 201: speciesSchema, ...errorResponses(400, 401, 403, 409) },
      },
    },
    async (request, reply): Promise<Species> => {
      const actor = request.actor!;
      authorize(actor, { action: "platform.manageSpecies" });
      const result = await createSpecies(db, request.body, {
        kind: "user",
        userId: actor.userId,
      });
      switch (result.outcome) {
        case "created":
          reply.code(201);
          return toSpecies(result.species);
        case "name_taken":
          throw nameTaken(result.field);
        default: {
          const unreachable: never = result;
          throw new Error(`Unknown outcome ${JSON.stringify(unreachable)}`);
        }
      }
    },
  );

  app.patch(
    "/species/:speciesId",
    {
      preHandler: app.requireActor,
      schema: {
        operationId: "updateSpecies",
        summary:
          "Change a species's names, its check, or switch it off or on (platform admins). Saving without a change is 200 too",
        params: speciesParamsSchema,
        body: updateSpeciesRequestSchema,
        response: { 200: speciesSchema, ...errorResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request): Promise<Species> => {
      const actor = request.actor!;
      authorize(actor, { action: "platform.manageSpecies" });
      const result = await updateSpecies(
        db,
        { id: request.params.speciesId, patch: request.body },
        { kind: "user", userId: actor.userId },
      );
      switch (result.outcome) {
        case "updated":
        case "unchanged":
          return toSpecies(result.species);
        case "not_found":
          throw apiError(404, apiErrorCodes.notFound, "Species not found");
        case "name_taken":
          throw nameTaken(result.field);
        default: {
          const unreachable: never = result;
          throw new Error(`Unknown outcome ${JSON.stringify(unreachable)}`);
        }
      }
    },
  );
};
