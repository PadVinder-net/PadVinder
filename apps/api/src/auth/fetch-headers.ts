import type { FastifyRequest } from "fastify";

/**
 * The request headers as Fetch `Headers`, the form Better Auth takes. A header that arrives more
 * than once keeps every value. `omit` lists lowercase names to leave out.
 */
export function toFetchHeaders(request: FastifyRequest, omit: readonly string[] = []): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || omit.includes(name)) continue;
    for (const item of [value].flat()) headers.append(name, item);
  }
  return headers;
}
