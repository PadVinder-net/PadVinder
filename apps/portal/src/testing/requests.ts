import { act } from "@testing-library/react";
import { FakeEventSource } from "@padvinder/api-client/testing";
import { afterEach } from "vitest";

// Helpers for page tests that check which requests a page sends and how it handles the answers.
// They wrap `fetch` on top of `mockFetch`; the wrapper is taken off after each test.

export type RecordedRequest = { method: string; path: string; body: unknown };

const restorers: Array<() => void> = [];
afterEach(() => {
  while (restorers.length > 0) restorers.pop()!();
});

/** mockFetch keeps only paths, so wrap fetch to record every request with its method and JSON body. */
export function recordRequests() {
  const requests: RecordedRequest[] = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.clone().text();
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: text === "" ? undefined : JSON.parse(text),
    });
    return inner(request);
  };
  restorers.push(() => (globalThis.fetch = inner));
  return requests;
}

/**
 * Holds back every request that `match` picks until the test calls `release`, so the test can act
 * while a save runs.
 */
export function holdRequests(match: (request: Request) => boolean) {
  const inner = globalThis.fetch;
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (match(request)) await released;
    return inner(request);
  };
  restorers.push(() => (globalThis.fetch = inner));
  return release;
}

/** Lets every request that `match` picks hang forever, as a slow load does. */
export function neverAnswer(match: (request: Request) => boolean) {
  const inner = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    return match(request) ? new Promise<Response>(() => {}) : inner(request);
  };
  restorers.push(() => (globalThis.fetch = inner));
}

/**
 * Answers every request that `match` picks with `answer(url)`, which sees the query too (mockFetch
 * answers by path only); every other request goes on to mockFetch.
 */
export function answerRequests(
  match: (url: URL, request: Request) => boolean,
  answer: (url: URL) => Response | Promise<Response>,
) {
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    return match(url, request) ? answer(url) : inner(request);
  };
  restorers.push(() => (globalThis.fetch = inner));
}

/** The requests with this method whose path starts with `prefix`. */
export function requestsTo(requests: RecordedRequest[], method: string, prefix: string) {
  return requests.filter((request) => request.method === method && request.path.startsWith(prefix));
}

/** An error answer of our API, in the shape of `apiErrorSchema`. */
export function errorResponse(
  status: number,
  code: string,
  issues?: { path: string; message: string }[],
) {
  return Response.json(
    { statusCode: status, error: "Error", message: "x", code, ...(issues ? { issues } : {}) },
    { status },
  );
}

/** What the server sends when someone's rights changed; the layout then asks again. */
export function emitAccessChanged(userId: string) {
  act(() => {
    for (const source of FakeEventSource.instances)
      source.emit("access-changed", JSON.stringify({ type: "access-changed", userId }));
  });
}
