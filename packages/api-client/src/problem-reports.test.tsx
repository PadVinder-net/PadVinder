import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { client } from "./generated/client.gen";
import { apiErrorCode, useReportProblem } from "./index";
import { createTestQueryClient } from "./testing";

beforeEach(() => client.setConfig({ baseUrl: "http://localhost" }));
afterEach(() => client.setConfig({ baseUrl: "", fetch: globalThis.fetch }));

/** Answers `POST /api/problem-reports` with `answer` and keeps the bodies sent. */
function mockReports(answer: Response) {
  const bodies: unknown[] = [];
  client.setConfig({
    fetch: async (input: Request | string | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (`${request.method} ${path}` !== "POST /api/problem-reports") {
        throw new TypeError(`No mock for ${request.method} ${path}`);
      }
      bodies.push(await request.json());
      return answer.clone();
    },
  });
  return { bodies };
}

function setup() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useReportProblem(), { wrapper });
}

const report = {
  message: "De knop doet niets",
  includeContact: true,
  page: "/app/more",
  appVersion: "2027.1.0",
  app: "app" as const,
};

test("sends the report and resolves on 204", async () => {
  const { bodies } = mockReports(new Response(null, { status: 204 }));
  const { result } = setup();
  await expect(result.current.mutateAsync(report)).resolves.toBeUndefined();
  expect(bodies).toEqual([report]);
});

test("a 502 surfaces with its code, so the form keeps the text", async () => {
  mockReports(
    Response.json(
      { statusCode: 502, error: "Bad Gateway", message: "x", code: "report_not_sent" },
      { status: 502 },
    ),
  );
  const { result } = setup();
  const error = await result.current.mutateAsync(report).catch((caught: unknown) => caught);
  expect(apiErrorCode(error)).toBe("report_not_sent");
});
