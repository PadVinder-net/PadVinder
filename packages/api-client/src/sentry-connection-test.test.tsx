import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { client } from "./generated/client.gen";
import { apiErrorCode, useTestSentryConnection } from "./index";
import { createTestQueryClient } from "./testing";

beforeEach(() => client.setConfig({ baseUrl: "http://localhost" }));
afterEach(() => client.setConfig({ baseUrl: "", fetch: globalThis.fetch }));

/** Answers `POST /api/system/sentry-connection-test` with `answer` and counts the calls. */
function mockConnectionTest(answer: Response) {
  const calls: string[] = [];
  client.setConfig({
    fetch: async (input: Request | string | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const call = `${request.method} ${new URL(request.url).pathname}`;
      if (call !== "POST /api/system/sentry-connection-test") {
        throw new TypeError(`No mock for ${call}`);
      }
      calls.push(call);
      return answer.clone();
    },
  });
  return { calls };
}

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTestSentryConnection(), { wrapper });
}

test("runs the test and resolves with the results", async () => {
  const body = {
    sentryOff: false,
    results: [
      { family: 4, status: 200 },
      { family: 6, status: "unreachable", answer: "ENETUNREACH" },
    ],
  };
  const { calls } = mockConnectionTest(Response.json(body));
  const { result } = setup();
  await expect(result.current.mutateAsync()).resolves.toEqual(body);
  expect(calls).toHaveLength(1);
});

test("a 403 surfaces with its code", async () => {
  mockConnectionTest(
    Response.json(
      { statusCode: 403, error: "Forbidden", message: "x", code: "not_allowed" },
      { status: 403 },
    ),
  );
  const { result } = setup();
  const error = await result.current.mutateAsync().catch((caught: unknown) => caught);
  expect(apiErrorCode(error)).toBe("not_allowed");
});
