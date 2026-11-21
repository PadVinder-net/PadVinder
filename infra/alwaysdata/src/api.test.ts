import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAlwaysdataApi, type AlwaysdataApi } from "./api.ts";
import { startFakeAlwaysdata, type FakeAlwaysdata } from "./testing/fake-api.ts";

const apiKey = "test-key/with+chars";
let fake: FakeAlwaysdata;
let api: AlwaysdataApi;

beforeAll(async () => {
  fake = await startFakeAlwaysdata();
  api = createAlwaysdataApi({
    apiKey,
    account: "acme",
    baseUrl: fake.baseUrl,
    minIntervalMs: 0,
    retryDelayMs: 1,
  });
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests.length = 0;
  for (const items of fake.resources.values()) items.length = 0;
});

test("sends Basic auth with the account in the username", async () => {
  let header: string | undefined;
  const spy = createAlwaysdataApi({
    apiKey,
    account: "acme",
    baseUrl: fake.baseUrl,
    minIntervalMs: 0,
    fetch: (input, init) => {
      header = new Headers(init?.headers).get("authorization") ?? undefined;
      return fetch(input, init);
    },
  });
  await spy.list("site");
  expect(header).toBe(`Basic ${Buffer.from(`${apiKey} account=acme:`).toString("base64")}`);
});

test("create returns the new resource even when POST has no body", async () => {
  const created = await api.create(
    "database",
    { name: "acme_staging", type: "POSTGRESQL" },
    { field: "name", value: "acme_staging" },
  );
  expect(created).toMatchObject({ name: "acme_staging", type: "POSTGRESQL" });
  expect(typeof created.id).toBe("number");
  expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
    "POST /v1/database/",
    "GET /v1/database/",
  ]);
});

test("create fails when the resource cannot be found afterwards", async () => {
  await expect(api.create("ssh", { name: "x" }, { field: "name", value: "other" })).rejects.toThrow(
    /did not find it/,
  );
});

test("update sends PATCH with only the given fields", async () => {
  const created = await api.create(
    "service",
    { annotation: "a", command: "c" },
    {
      field: "annotation",
      value: "a",
    },
  );
  await api.update("service", created.id, { command: "d" });
  const patch = fake.requests.find((r) => r.method === "PATCH");
  expect(patch).toEqual({
    method: "PATCH",
    path: `/v1/service/${created.id}/`,
    body: { command: "d" },
  });
  expect(fake.resources.get("service")?.[0]).toMatchObject({ annotation: "a", command: "d" });
});

test("restartService posts to the restart endpoint", async () => {
  await api.restartService(7);
  expect(fake.requests.at(-1)).toMatchObject({ method: "POST", path: "/v1/service/7/restart/" });
});

test("retries a 429 and a 503, then succeeds", async () => {
  fake.failNext(429);
  fake.failNext(503);
  await expect(api.list("site")).resolves.toEqual([]);
  expect(fake.requests).toHaveLength(3);
});

test("gives up after three tries on a persistent 503", async () => {
  fake.failNext(503);
  fake.failNext(503);
  fake.failNext(503);
  await expect(api.list("site")).rejects.toThrow(/failed with 503/);
  expect(fake.requests).toHaveLength(3);
});

test("does not retry a 400", async () => {
  fake.failNext(400);
  await expect(api.list("site")).rejects.toThrow();
  expect(fake.requests).toHaveLength(1);
});

test("an error names method, path and status, without the API key", async () => {
  const echoing = createAlwaysdataApi({
    apiKey,
    account: "acme",
    minIntervalMs: 0,
    fetch: async () => new Response(`bad key ${apiKey}`, { status: 400 }),
  });
  const error = await echoing.list("site").catch((e: unknown) => e);
  expect((error as Error).message).toMatch(/GET \/v1\/site\/ failed with 400/);
  expect((error as Error).message).not.toContain(apiKey);

  fake.failNext(400);
  await expect(api.list("site")).rejects.toThrow(/GET \/v1\/site\/ failed with 400/);
});

test("spaces requests by minIntervalMs", async () => {
  const slow = createAlwaysdataApi({
    apiKey,
    account: "acme",
    baseUrl: fake.baseUrl,
    minIntervalMs: 50,
  });
  const start = Date.now();
  await Promise.all([slow.list("site"), slow.list("site"), slow.list("site")]);
  expect(Date.now() - start).toBeGreaterThanOrEqual(95);
});
