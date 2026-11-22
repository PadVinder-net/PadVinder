import { QueryClient } from "@tanstack/react-query";
import { meFixture } from "@padvinder/contracts/fixtures";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { client } from "./generated/client.gen";
import { getMeQueryKey, meQueryOptions } from "./index";

beforeEach(() => client.setConfig({ baseUrl: "http://localhost" }));
afterEach(() => client.setConfig({ baseUrl: "", fetch: globalThis.fetch }));

function stubFetch(status: number, body: unknown) {
  client.setConfig({ fetch: vi.fn(async () => Response.json(body, { status })) });
}

test("keeps the generated query key", () => {
  expect(meQueryOptions().queryKey).toEqual(getMeQueryKey());
});

test("401 resolves to null", async () => {
  stubFetch(401, { code: "not_logged_in", message: "x" });
  expect(await new QueryClient().fetchQuery(meQueryOptions())).toBeNull();
});

test("200 resolves to the user", async () => {
  stubFetch(200, meFixture);
  expect(await new QueryClient().fetchQuery(meQueryOptions())).toEqual(meFixture);
});

test("500 rejects", async () => {
  stubFetch(500, { code: "internal_error", message: "x" });
  await expect(new QueryClient().fetchQuery(meQueryOptions())).rejects.toBeDefined();
});
