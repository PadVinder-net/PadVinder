import { QueryClientProvider } from "@tanstack/react-query";
import {
  accountSummaryFixture,
  meFixture,
  platformAdminsFixture,
} from "@padvinder/contracts/fixtures";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { client } from "./generated/client.gen";
import {
  accountDeletionBlockers,
  apiErrorCode,
  useAddPlatformAdmin,
  useDeleteAccountOf,
  useFindAccount,
  useMe,
  usePlatformAdmins,
  useRemovePlatformAdmin,
} from "./index";
import { createTestQueryClient } from "./testing";

beforeEach(() => client.setConfig({ baseUrl: "http://localhost" }));
afterEach(() => client.setConfig({ baseUrl: "", fetch: globalThis.fetch }));

type Seen = { call: string; url: string; body: string };

/** Answers by "METHOD /path" and keeps what each request looked like. */
function mockFetch(routes: Record<string, unknown>) {
  const seen: Seen[] = [];
  client.setConfig({
    fetch: async (input: Request | string | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      const call = `${request.method} ${path}`;
      seen.push({ call, url: request.url, body: await request.clone().text() });
      const answer = routes[call];
      if (answer === undefined) throw new TypeError(`No mock for ${call}`);
      return answer instanceof Response ? answer.clone() : Response.json(answer);
    },
  });
  return { seen, count: (call: string) => seen.filter((s) => s.call === call).length };
}

function setup<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper });
}

const error = (status: number, code: string, extra: object = {}) =>
  Response.json({ statusCode: status, error: "x", message: "x", code, ...extra }, { status });

const list = { platformAdmins: platformAdminsFixture };
const otherId = "0192f3c0-0000-7000-8000-0000000000d1";

test("appointing and removing a platform admin refetch the list and me, also after an error", async () => {
  const m = mockFetch({
    "GET /api/platform-admins": list,
    "GET /api/me": meFixture,
    "POST /api/platform-admins": list,
    [`DELETE /api/platform-admins/${otherId}`]: error(409, "last_platform_admin"),
  });
  const { result } = setup(() => ({
    list: usePlatformAdmins(),
    me: useMe(),
    add: useAddPlatformAdmin(),
    remove: useRemovePlatformAdmin(),
  }));
  await waitFor(() =>
    expect(result.current.list.isSuccess && result.current.me.isSuccess).toBe(true),
  );
  await result.current.add.mutateAsync("nieuw@example.test");
  await waitFor(() => expect(m.count("GET /api/platform-admins")).toBe(2));
  await waitFor(() => expect(m.count("GET /api/me")).toBe(2));
  expect(JSON.parse(m.seen.find((s) => s.call === "POST /api/platform-admins")!.body)).toEqual({
    email: "nieuw@example.test",
  });
  await expect(result.current.remove.mutateAsync(otherId)).rejects.toMatchObject({
    code: "last_platform_admin",
  });
  await waitFor(() => expect(m.count("GET /api/platform-admins")).toBe(3));
  await waitFor(() => expect(m.count("GET /api/me")).toBe(3));
});

test("useFindAccount gives null for a 404 and throws for a 403", async () => {
  mockFetch({ "POST /api/users/lookup": Response.json(accountSummaryFixture) });
  const found = setup(() => useFindAccount());
  expect(await found.result.current.mutateAsync("sanne@example.test")).toEqual(
    accountSummaryFixture,
  );
  mockFetch({ "POST /api/users/lookup": error(404, "not_found") });
  const none = setup(() => useFindAccount());
  expect(await none.result.current.mutateAsync("niemand@example.test")).toBeNull();
  mockFetch({ "POST /api/users/lookup": error(403, "not_allowed") });
  const denied = setup(() => useFindAccount());
  await expect(denied.result.current.mutateAsync("x@example.test")).rejects.toMatchObject({
    code: "not_allowed",
  });
});

test("the address of a lookup is in the request's body, not in its address", async () => {
  const m = mockFetch({ "POST /api/users/lookup": Response.json(accountSummaryFixture) });
  const { result } = setup(() => useFindAccount());
  await result.current.mutateAsync("sanne@example.test");
  const request = m.seen[0]!;
  expect(JSON.parse(request.body)).toEqual({ email: "sanne@example.test" });
  expect(request.url).not.toContain("sanne");
  expect(request.url).not.toContain("example.test");
});

test("a blocked deletion surfaces with its code and blockers, and the lists are refetched", async () => {
  const blockers = [
    {
      role: "coordinator",
      workingGroupName: "Noord",
      organizationName: "Paddentrek Voorbeeldstad",
      contactEmail: null,
    },
  ];
  const m = mockFetch({
    "GET /api/platform-admins": list,
    "GET /api/organizations": [],
    [`DELETE /api/users/${otherId}`]: error(409, "last_coordinator", { blockers }),
  });
  const { result } = setup(() => ({ list: usePlatformAdmins(), del: useDeleteAccountOf() }));
  await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
  let caught: unknown;
  await result.current.del.mutateAsync(otherId).catch((e: unknown) => (caught = e));
  expect(apiErrorCode(caught)).toBe("last_coordinator");
  expect(accountDeletionBlockers(caught)).toHaveLength(1);
  await waitFor(() => expect(m.count("GET /api/platform-admins")).toBe(2));
});
