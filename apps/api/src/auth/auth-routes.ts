import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { Auth } from "./auth";

/** The request as a Fetch `Request`, the form Better Auth's handler takes. */
function toFetchRequest(request: FastifyRequest, origin: string): Request {
  // The URL is built on our own origin, never on the Host header a client sends.
  const url = new URL(request.url, origin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    // The body is serialized again below, so its length and encoding may differ.
    if (value === undefined || name === "content-length" || name === "transfer-encoding") continue;
    for (const item of [value].flat()) headers.append(name, item);
  }
  const hasBody = request.body !== undefined && request.body !== null;
  return new Request(url, {
    method: request.method,
    headers,
    ...(hasBody && { body: JSON.stringify(request.body) }),
  });
}

/**
 * Better Auth's own routes under `/api/auth/*`, mounted as its Fastify guide describes. They are
 * the one exception to "Zod schemas are the API contract" and are hidden from OpenAPI.
 * Register with the prefix `/api`. The Origin hook on the root instance covers them too.
 */
export const authRoutes: FastifyPluginAsync<{ auth: Auth; origin: string }> = async (
  api,
  { auth, origin },
) => {
  api.route({
    method: ["GET", "POST"],
    url: "/auth/*",
    schema: { hide: true },
    async handler(request, reply) {
      const response = await auth.handler(toFetchRequest(request, origin));
      reply.status(response.status);
      response.headers.forEach((value, name) => {
        // Set-Cookie is copied one by one below; Fastify sets the length itself.
        if (name === "set-cookie" || name === "content-length") return;
        reply.header(name, value);
      });
      // Several cookies at once (sign-out clears a few): each must reach the client.
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
};
