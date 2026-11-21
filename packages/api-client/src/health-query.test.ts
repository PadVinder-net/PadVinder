import { QueryClient } from "@tanstack/react-query";
import { databaseUnreachableFixture, healthyFixture } from "@padvinder/contracts/fixtures";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { client } from "./generated/client.gen";
import { getHealthQueryKey, healthQueryOptions } from "./index";

// The generated client keeps the fetch it was created with, so stubbing the global is too late.
beforeEach(() => client.setConfig({ baseUrl: "http://localhost" }));
afterEach(() => client.setConfig({ baseUrl: "", fetch: globalThis.fetch }));

function stubFetch(status: number, body: unknown) {
  client.setConfig({ fetch: vi.fn(async () => Response.json(body, { status })) });
}

test("keeps the generated query key", () => {
  expect(healthQueryOptions().queryKey).toEqual(getHealthQueryKey());
});

test("refetches every minute, so a missing heartbeat shows on an open page", () => {
  const options = healthQueryOptions();
  expect(options.refetchInterval).toBe(60_000);
  // Left at the default (refetch when the window regains focus).
  expect(options.refetchOnWindowFocus).toBeUndefined();
});

test("a 200 resolves as data", async () => {
  stubFetch(200, healthyFixture);
  const data = await new QueryClient().fetchQuery(healthQueryOptions());
  expect(data).toEqual(healthyFixture);
});

test("a 503 with a degraded body resolves as data", async () => {
  stubFetch(503, databaseUnreachableFixture);
  const data = await new QueryClient().fetchQuery(healthQueryOptions());
  expect(data).toEqual(databaseUnreachableFixture);
});

test("an error without a health body still rejects", async () => {
  stubFetch(500, { message: "boom" });
  await expect(
    new QueryClient().fetchQuery({ ...healthQueryOptions(), retry: false }),
  ).rejects.toBeDefined();
});
