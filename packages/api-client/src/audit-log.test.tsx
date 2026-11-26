import { QueryClientProvider } from "@tanstack/react-query";
import { auditLogFixture } from "@padvinder/contracts/fixtures";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { client } from "./generated/client.gen";
import { useAuditLog } from "./index";
import { createTestQueryClient } from "./testing";

beforeEach(() => client.setConfig({ baseUrl: "http://localhost" }));
afterEach(() => client.setConfig({ baseUrl: "", fetch: globalThis.fetch }));

/** Answers `GET /api/audit-log-entries` with `answer(url)`, and keeps every URL it saw. */
function mockLog(answer: (url: URL) => Response) {
  const urls: URL[] = [];
  client.setConfig({
    fetch: async (input: Request | string | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      urls.push(url);
      return answer(url);
    },
  });
  return { urls };
}

function setup<T, P>(hook: (props: P) => T, initialProps: P) {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper, initialProps });
}

const first = auditLogFixture.slice(0, 2);
const second = auditLogFixture.slice(2, 3);

test("useAuditLog loads the first page and says whether there is more", async () => {
  mockLog(() => Response.json({ entries: first, nextCursor: "c1" }));
  const { result } = setup(() => useAuditLog({}), undefined);
  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(result.current.entries).toEqual(first);
  expect(result.current.hasMore).toBe(true);
});

test("loadMore asks with the last cursor and appends the entries", async () => {
  const { urls } = mockLog((url) =>
    url.searchParams.get("cursor") === "c1"
      ? Response.json({ entries: second, nextCursor: null })
      : Response.json({ entries: first, nextCursor: "c1" }),
  );
  const { result } = setup(() => useAuditLog({}), undefined);
  await waitFor(() => expect(result.current.hasMore).toBe(true));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.entries).toEqual([...first, ...second]));
  expect(urls[1]!.searchParams.get("cursor")).toBe("c1");
  expect(result.current.hasMore).toBe(false);
});

test("changing a filter starts again at the first page, without a cursor", async () => {
  const { urls } = mockLog((url) =>
    url.searchParams.get("cursor") === "c1"
      ? Response.json({ entries: second, nextCursor: null })
      : Response.json({ entries: first, nextCursor: "c1" }),
  );
  const { result, rerender } = setup(
    (filters: { actionGroup?: "role" }) => useAuditLog(filters),
    {} as { actionGroup?: "role" },
  );
  await waitFor(() => expect(result.current.hasMore).toBe(true));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.entries).toHaveLength(3));
  rerender({ actionGroup: "role" });
  await waitFor(() => expect(result.current.entries).toEqual(first));
  const last = urls.at(-1)!;
  expect(last.searchParams.get("actionGroup")).toBe("role");
  expect(last.searchParams.has("cursor")).toBe(false);
});

test("a failed loadMore keeps the loaded entries and sets loadMoreFailed", async () => {
  mockLog((url) =>
    url.searchParams.get("cursor") === "c1"
      ? Response.json(
          { statusCode: 404, error: "Not Found", message: "x", code: "not_found" },
          { status: 404 },
        )
      : Response.json({ entries: first, nextCursor: "c1" }),
  );
  const { result } = setup(() => useAuditLog({}), undefined);
  await waitFor(() => expect(result.current.hasMore).toBe(true));
  act(() => result.current.loadMore());
  await waitFor(() => expect(result.current.loadMoreFailed).toBe(true));
  expect(result.current.entries).toEqual(first);
  expect(result.current.loadingMore).toBe(false);
});
