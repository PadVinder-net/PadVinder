import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
  fake.failNext(400);
  const error = await api.list("site").catch((e: unknown) => e);
  expect((error as Error).message).toMatch(/GET \/v1\/site\/ failed with 400/);
  expect((error as Error).message).not.toContain(apiKey);
});

test("redacts the key in an error body, also near the truncation point", async () => {
  const echoing = createAlwaysdataApi({
    apiKey,
    account: "acme",
    minIntervalMs: 0,
    fetch: async () => new Response(`${"x".repeat(490)}${apiKey}`, { status: 400 }),
  });
  const error = (await echoing.list("site").catch((e: unknown) => e)) as Error;
  expect(error.message).toMatch(/failed with 400/);
  expect(error.message).not.toContain(apiKey.slice(0, 8));
});

test("a retried create does not make a second resource", async () => {
  fake.failNextAfterApply(503);
  const created = await api.create(
    "database",
    { name: "acme_staging" },
    { field: "name", value: "acme_staging" },
  );
  expect(created.name).toBe("acme_staging");
  expect(fake.resources.get("database")).toHaveLength(1);
  expect(fake.requests.filter((r) => r.method === "POST")).toHaveLength(1);
});

test("create retries a POST that was not stored", async () => {
  fake.failNext(503);
  await api.create("ssh", { name: "u" }, { field: "name", value: "u" });
  expect(fake.requests.filter((r) => r.method === "POST")).toHaveLength(2);
  expect(fake.resources.get("ssh")).toHaveLength(1);
});

test("create throws when two resources share the identity", async () => {
  fake.resources.get("ssh")?.push({ id: 91, name: "u" }, { id: 92, name: "u" });
  await expect(api.create("ssh", { name: "u" }, { field: "name", value: "u" })).rejects.toThrow(
    /expected one/,
  );
});

test("a network error is retried for GET and wrapped without secrets", async () => {
  let calls = 0;
  const flaky = createAlwaysdataApi({
    apiKey,
    account: "acme",
    baseUrl: fake.baseUrl,
    minIntervalMs: 0,
    retryDelayMs: 1,
    fetch: (input, init) => {
      calls++;
      if (calls === 1) return Promise.reject(new TypeError("fetch failed"));
      return fetch(input, init);
    },
  });
  await expect(flaky.list("site")).resolves.toEqual([]);
  expect(calls).toBe(2);

  const down = createAlwaysdataApi({
    apiKey,
    account: "acme",
    minIntervalMs: 0,
    fetch: () => {
      calls = 100;
      return Promise.reject(new TypeError(`reset ${apiKey}`));
    },
  });
  const error = (await down
    .create("ssh", { name: "u" }, { field: "name", value: "u" })
    .catch((e: unknown) => e)) as Error;
  expect(calls).toBe(100);
  expect(error.message).toMatch(/POST \/v1\/ssh\/ failed with 0: network error/);
  expect(error.message).not.toContain(apiKey);
});

test("a request without an answer times out: retried for GET, not for POST", async () => {
  // Accepts every request and never answers.
  let received = 0;
  const silent = createServer(() => void received++);
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  try {
    const hanging = createAlwaysdataApi({
      apiKey,
      account: "acme",
      baseUrl: `http://127.0.0.1:${(silent.address() as AddressInfo).port}`,
      minIntervalMs: 0,
      retryDelayMs: 1,
      requestTimeoutMs: 50,
    });
    const listError = (await hanging.list("site").catch((e: unknown) => e)) as Error;
    expect(listError.message).toBe("GET /v1/site/ failed with 0: timeout: no answer within 50 ms");
    expect(received).toBe(3);

    received = 0;
    const restartError = (await hanging.restartService(7).catch((e: unknown) => e)) as Error;
    expect(restartError.message).toMatch(/POST \/v1\/service\/7\/restart\/ failed with 0: timeout/);
    expect(restartError.message).not.toContain(apiKey);
    expect(received).toBe(1);
  } finally {
    silent.closeAllConnections();
    await new Promise((resolve) => silent.close(resolve));
  }
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
