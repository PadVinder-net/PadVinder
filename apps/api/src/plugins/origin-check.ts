import type { FastifyInstance } from "fastify";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rejects state-changing requests that come from a browser page on another site.
 * A request without an `Origin` header (curl, server-to-server) passes.
 *
 * Called on the root instance, not registered as an encapsulated plugin, so the hook also
 * covers routes registered later and requests for unknown paths.
 */
export function addOriginCheck(app: FastifyInstance, allowedOrigins: readonly string[]): void {
  const allowed = new Set(allowedOrigins);
  app.addHook("onRequest", async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin !== undefined && !allowed.has(origin)) {
      // The same shape as Fastify's own errors.
      return reply
        .code(403)
        .send({ statusCode: 403, error: "Forbidden", message: "Origin not allowed" });
    }
  });
}
