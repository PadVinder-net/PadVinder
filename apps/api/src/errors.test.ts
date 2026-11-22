import { apiErrorSchema } from "@padvinder/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { addErrorHandling, apiError, errorResponses } from "./errors";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  addErrorHandling(app);
  app.get("/api/conflict", async () => {
    throw apiError(409, "not_allowed", "Nope");
  });
  app.post(
    "/api/validated",
    {
      schema: {
        body: z.object({ name: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }), ...errorResponses(400) },
      },
    },
    async () => ({ ok: true }),
  );
  app.get("/api/boom", async () => {
    throw new Error("password=hunter2");
  });
  await app.ready();
});
afterAll(() => app.close());

test("an ApiError becomes its body", async () => {
  const res = await app.inject("/api/conflict");
  expect(res.statusCode).toBe(409);
  expect(apiErrorSchema.parse(res.json())).toMatchObject({ statusCode: 409, code: "not_allowed" });
});

test("a validation failure is 400 invalid_request with issues", async () => {
  const res = await app.inject({ method: "POST", url: "/api/validated", payload: {} });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ statusCode: 400, code: "invalid_request" });
  expect(res.json().issues[0]).toMatchObject({ path: "name" });
});

test("an unexpected error is 500 internal_error and hides its message", async () => {
  const res = await app.inject("/api/boom");
  expect(res.statusCode).toBe(500);
  expect(res.json()).toMatchObject({ statusCode: 500, code: "internal_error" });
  expect(res.body).not.toContain("hunter2");
});

test("an unknown /api path is 404 not_found in the same shape", async () => {
  const res = await app.inject("/api/nope");
  expect(res.statusCode).toBe(404);
  expect(apiErrorSchema.parse(res.json())).toMatchObject({ statusCode: 404, code: "not_found" });
});

test("malformed JSON is 400 invalid_request", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/validated",
    headers: { "content-type": "application/json" },
    payload: "{",
  });
  expect(res.json()).toMatchObject({ statusCode: 400, code: "invalid_request" });
});
