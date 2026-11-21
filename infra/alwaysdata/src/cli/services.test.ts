import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAlwaysdataApi, type AlwaysdataApi } from "../api.ts";
import { startFakeAlwaysdata, type FakeAlwaysdata } from "../testing/fake-api.ts";
import { parseServicesArgs, runServices } from "./services.ts";

const apiKey = "api/key+value";
const account = "acmecorp";

let fake: FakeAlwaysdata;
let api: AlwaysdataApi;
let output: string[];

beforeAll(async () => {
  fake = await startFakeAlwaysdata();
  api = createAlwaysdataApi({
    apiKey,
    account,
    baseUrl: fake.baseUrl,
    minIntervalMs: 0,
    retryDelayMs: 1,
  });
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests.length = 0;
  fake.resources.set("service", [
    { id: 1, annotation: "padvinder-api (staging)", is_disabled: true },
    { id: 2, annotation: "padvinder-worker (staging)", is_disabled: true },
  ]);
  output = [];
});

const runWith = (argv: string[]) =>
  runServices({
    args: parseServicesArgs(argv),
    config: { environment: "staging", account, apiKey },
    api,
    print: (line) => output.push(line),
  });
const writes = () =>
  fake.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`);

test("--enable and --disable patch both services", async () => {
  expect(await runWith(["--environment", "staging", "--enable"])).toBe(0);
  expect(writes()).toEqual(["PATCH /v1/service/1/", "PATCH /v1/service/2/"]);
  expect(fake.resources.get("service")!.map((s) => s.is_disabled)).toEqual([false, false]);
  expect(await runWith(["--environment", "staging", "--disable"])).toBe(0);
  expect(fake.resources.get("service")!.map((s) => s.is_disabled)).toEqual([true, true]);
  expect(output.join("\n")).toMatch(/Disabled padvinder-api \(staging\) and padvinder-worker/);
});

test("--restart restarts both services", async () => {
  expect(await runWith(["--environment", "staging", "--restart"])).toBe(0);
  expect(writes()).toEqual(["POST /v1/service/1/restart/", "POST /v1/service/2/restart/"]);
});

test("a missing service exits 1 with a redacted message", async () => {
  fake.resources.set("service", []);
  expect(await runWith(["--environment", "staging", "--restart"])).toBe(1);
  const text = output.join("\n");
  expect(text).toMatch(/padvinder-api \(staging\)/);
  expect(text).not.toContain(apiKey);
});

test("an IP address in an error shows as <ip>", async () => {
  const unreachable: AlwaysdataApi = {
    ...api,
    list: async () => {
      throw new Error(
        "GET /v1/service/ failed with 0: network error: connect ECONNREFUSED 192.0.2.10:443",
      );
    },
  };
  const code = await runServices({
    args: parseServicesArgs(["--environment", "staging", "--restart"]),
    config: { environment: "staging", account, apiKey },
    api: unreachable,
    print: (line) => output.push(line),
  });
  expect(code).toBe(1);
  expect(output.join("\n")).toContain("connect ECONNREFUSED <ip>:443");
});

test("parseServicesArgs needs exactly one action", () => {
  expect(parseServicesArgs(["--environment", "production", "--restart"])).toEqual({
    environment: "production",
    action: "restart",
  });
  for (const bad of [
    [],
    ["--environment", "staging"],
    ["--environment", "staging", "--enable", "--disable"],
    ["--environment", "test", "--enable"],
    ["--environment", "staging", "--enable", "extra"],
  ]) {
    expect(() => parseServicesArgs(bad)).toThrow(/Usage/);
  }
});

test("the CLI exits 2 on a usage error and 1 on missing variables", () => {
  const script = fileURLToPath(new URL("./services.ts", import.meta.url));
  const env = { PATH: process.env.PATH ?? "" };
  expect(spawnSync(process.execPath, [script], { env, encoding: "utf8" }).status).toBe(2);
  const missing = spawnSync(process.execPath, [script, "--environment", "staging", "--enable"], {
    env,
    encoding: "utf8",
  });
  expect(missing.status).toBe(1);
  expect(missing.stderr).toMatch(/ALWAYSDATA_API_KEY/);
  expect(missing.stderr).not.toMatch(/DEPLOY_SSH_KEY_FILE|DATABASE_PASSWORD/);
});
