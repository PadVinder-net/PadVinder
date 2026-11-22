import { QueryClient } from "@tanstack/react-query";
import { afterEach } from "vitest";

type FetchHandler = (request: Request) => Promise<Response>;

const noHandler: FetchHandler = async (request) => {
  throw new TypeError(`No mock for ${request.url}`);
};
let handler = noHandler;

/**
 * The generated API client keeps the `fetch` it finds when its module loads, so stubbing the global
 * later is too late. This installs one stable `fetch` up front (called from `vitest.setup.ts`)
 * that forwards to whatever `mockFetch` set.
 */
export function installFetchProxy() {
  // The generated client builds `new Request("/api/...")`, which Node rejects without a base URL.
  const NativeRequest = globalThis.Request;
  globalThis.Request = class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  };
  globalThis.fetch = (input, init) => handler(new Request(input, init));
  afterEach(() => {
    handler = noHandler;
  });
}

/** Answers `fetch` by URL path, or by "METHOD /path". A `Response` is returned as is; anything else becomes a 200 JSON body. */
export function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  handler = async (request) => {
    const path = new URL(request.url).pathname;
    calls.push(path);
    // A key like "PATCH /api/me" answers only that method and wins over the plain path.
    const answer = routes[`${request.method} ${path}`] ?? routes[path];
    if (answer === undefined) throw new TypeError(`No mock for ${request.url}`);
    return answer instanceof Response ? answer.clone() : Response.json(answer);
  };
  return { calls };
}

/** Never answers: the request stays pending. */
export function mockPendingFetch() {
  handler = () => new Promise(() => {});
}

/** A client that does not retry, so failures show up at once. */
export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
