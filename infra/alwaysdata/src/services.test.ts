import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAlwaysdataApi, type AlwaysdataApi } from "./api.ts";
import { findServices, restartServices, setServicesEnabled } from "./services.ts";
import { startFakeAlwaysdata, type FakeAlwaysdata } from "./testing/fake-api.ts";

let fake: FakeAlwaysdata;
let api: AlwaysdataApi;

beforeAll(async () => {
  fake = await startFakeAlwaysdata();
  api = createAlwaysdataApi({
    apiKey: "key",
    account: "acmecorp",
    baseUrl: fake.baseUrl,
    minIntervalMs: 0,
    retryDelayMs: 1,
  });
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests.length = 0;
  fake.resources.set("service", [
    { id: 11, annotation: "padvinder-api (production)", is_disabled: false },
    { id: 21, annotation: "padvinder-api (staging)", is_disabled: true },
    { id: 22, annotation: "padvinder-worker (staging)", is_disabled: true },
    { id: 31, annotation: "something else", is_disabled: false },
  ]);
});

test("finds the services of an environment by annotation", async () => {
  const services = await findServices(api, "staging");
  expect(services.api.id).toBe(21);
  expect(services.worker.id).toBe(22);
});

test("names the missing service", async () => {
  await expect(findServices(api, "production")).rejects.toThrow(
    /padvinder-worker \(production\).*pnpm infra:provision/,
  );
});

test("refuses two services with the same annotation", async () => {
  fake.resources.get("service")!.push({ id: 23, annotation: "padvinder-api (staging)" });
  await expect(findServices(api, "staging")).rejects.toThrow(
    /2 services.*padvinder-api \(staging\)/,
  );
});

test("enables and disables both services", async () => {
  await setServicesEnabled(api, "staging", true);
  const writes = () => fake.requests.filter((r) => r.method !== "GET");
  expect(writes()).toEqual([
    { method: "PATCH", path: "/v1/service/21/", body: { is_disabled: false } },
    { method: "PATCH", path: "/v1/service/22/", body: { is_disabled: false } },
  ]);
  // It reads the services again to check the change.
  expect(fake.requests.map((r) => r.method).at(-1)).toBe("GET");
  fake.requests.length = 0;
  await setServicesEnabled(api, "staging", false);
  expect(writes()).toEqual([
    { method: "PATCH", path: "/v1/service/21/", body: { is_disabled: true } },
    { method: "PATCH", path: "/v1/service/22/", body: { is_disabled: true } },
  ]);
});

test("checks that the API applied is_disabled", async () => {
  // An API that accepts the PATCH but ignores the field, as it might for a wrong field name.
  const ignoring: AlwaysdataApi = { ...api, update: async () => {} };
  await expect(setServicesEnabled(ignoring, "staging", true)).rejects.toThrow(
    /The API did not apply is_disabled: padvinder-api \(staging\) and padvinder-worker \(staging\) still have is_disabled=true after setting it to false\. The field name may be wrong \(UNVERIFIED/,
  );
  // One service applied, one not.
  const partial: AlwaysdataApi = {
    ...api,
    update: async (kind, id, patch) => (id === 21 ? api.update(kind, id, patch) : undefined),
  };
  await expect(setServicesEnabled(partial, "staging", true)).rejects.toThrow(
    /did not apply is_disabled: padvinder-worker \(staging\) still has is_disabled=true/,
  );
});

test("restarts the API, then the worker, and returns the time before the worker's restart", async () => {
  const restartsAtNow: number[] = [];
  const at = await restartServices(api, await findServices(api, "staging"), () => {
    restartsAtNow.push(fake.requests.filter((r) => r.method === "POST").length);
    return new Date("2027-03-01T20:00:00Z");
  });
  expect(fake.requests.filter((r) => r.method !== "GET").map((r) => r.path)).toEqual([
    "/v1/service/21/restart/",
    "/v1/service/22/restart/",
  ]);
  // Read once, after the API's restart and before the worker's.
  expect(restartsAtNow).toEqual([1]);
  expect(at.toISOString()).toBe("2027-03-01T20:00:00.000Z");
});
