import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAlwaysdataApi, type AlwaysdataApi } from "../api.ts";
import type { InfraConfig } from "../config.ts";
import { renderEnvFile } from "../env-file.ts";
import type { Remote } from "../remote.ts";
import { startFakeAlwaysdata, type FakeAlwaysdata } from "../testing/fake-api.ts";
import { parseProvisionArgs, runProvision, type ProvisionArgs } from "./provision.ts";

const password = "p@ss/w+rd";
const apiKey = "api/key+value";
const config: InfraConfig = {
  environment: "staging",
  account: "acmecorp",
  apiKey,
  databasePassword: password,
  ssh: {
    host: "ssh-acmecorp.alwaysdata.net",
    user: "acmecorp_deploy",
    keyFile: "/nonexistent/key",
    knownHostsFile: "/nonexistent/known_hosts",
  },
};
const args = (overrides: Partial<ProvisionArgs> = {}): ProvisionArgs => ({
  environment: "staging",
  apply: false,
  rotatePassword: false,
  inspect: false,
  ...overrides,
});

let fake: FakeAlwaysdata;
let api: AlwaysdataApi;
let calls: { method: string; args: unknown[] }[];
let output: string[];
const fakeRemote: Remote = {
  exec: async (...callArgs) => {
    calls.push({ method: "exec", args: callArgs });
    return { stdout: "", stderr: "" };
  },
  writeFile: async (...callArgs) => void calls.push({ method: "writeFile", args: callArgs }),
  upload: async (...callArgs) => void calls.push({ method: "upload", args: callArgs }),
};

beforeAll(async () => {
  fake = await startFakeAlwaysdata();
  api = createAlwaysdataApi({
    apiKey,
    account: config.account,
    baseUrl: fake.baseUrl,
    minIntervalMs: 0,
    retryDelayMs: 1,
  });
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests.length = 0;
  for (const items of fake.resources.values()) items.length = 0;
  calls = [];
  output = [];
});

const run = (provisionArgs: ProvisionArgs) =>
  runProvision({
    args: provisionArgs,
    config,
    api,
    remote: () => fakeRemote,
    print: (line) => output.push(line),
  });
const writes = () => fake.requests.filter((r) => r.method !== "GET");

const expectNoSecrets = (text: string) => {
  for (const value of [password, encodeURIComponent(password), apiKey, config.account]) {
    expect(text).not.toContain(value);
  }
};

test("without --apply it prints the plan and changes nothing", async () => {
  expect(await run(args())).toBe(0);
  expect(writes()).toEqual([]);
  expect(calls).toEqual([]);
  expect(output.join("\n")).toMatch(/create\s+service\s+padvinder-api \(staging\)/);
});

test("plan output never contains the password", async () => {
  expect(await run(args({ apply: true }))).toBe(0);
  fake.resources.get("database")![0]!.locale = `x${password}`;
  expect(await run(args({ rotatePassword: true }))).toBe(1);
  const text = output.join("\n");
  expect(text).toMatch(/create\s+database\/user\s+<account>_staging/);
  expect(text).toMatch(/conflict\s+database/);
  expectNoSecrets(text);
});

test("with --apply it creates the resources, then writes the env file and the releases directory", async () => {
  expect(await run(args({ apply: true }))).toBe(0);
  expect(writes().filter((r) => r.method === "POST")).toHaveLength(6);
  expect(calls).toEqual([
    {
      method: "writeFile",
      args: [
        "padvinder/staging/.env",
        renderEnvFile({ account: config.account, env: "staging", databasePassword: password }),
        0o600,
      ],
    },
    { method: "exec", args: ["mkdir -p -- padvinder/staging/releases"] },
  ]);
  expectNoSecrets(output.join("\n"));
});

test("a second --apply writes nothing to the API and rewrites the same env file", async () => {
  await run(args({ apply: true }));
  const count = writes().length;
  const first = calls;
  calls = [];
  expect(await run(args({ apply: true }))).toBe(0);
  expect(writes().length).toBe(count);
  expect(calls).toEqual(first);
});

test("a conflict exits 1 and changes nothing", async () => {
  await run(args({ apply: true }));
  fake.resources.get("database")![0]!.locale = "en_US.UTF-8";
  fake.requests.length = 0;
  calls = [];
  output = [];
  expect(await run(args({ apply: true }))).toBe(1);
  expect(writes()).toEqual([]);
  expect(calls).toEqual([]);
  expect(output.join("\n")).toMatch(/locale/);
});

test("an SSH failure after apply exits 1 and says how to add the deploy key", async () => {
  const failing: Remote = {
    ...fakeRemote,
    writeFile: async () => {
      throw new Error(`Permission denied for ${config.account}_deploy`);
    },
  };
  const code = await runProvision({
    args: args({ apply: true }),
    config,
    api,
    remote: () => failing,
    print: (line) => output.push(line),
  });
  expect(code).toBe(1);
  const text = output.join("\n");
  expect(text).toMatch(/add the deploy public key to SSH user <account>_deploy/);
  expect(text).toMatch(/Permission denied for <account>_deploy/);
  expectNoSecrets(text);
});

test("an API error exits 1 with a redacted message", async () => {
  fake.failNext(400);
  expect(await run(args({ apply: true }))).toBe(1);
  expect(output.join("\n")).toMatch(/failed with 400/);
  expectNoSecrets(output.join("\n"));
});

test("--inspect lists every resource without password-like fields", async () => {
  fake.resources.get("database/user")!.push({
    id: 7,
    name: "acmecorp_staging",
    password: "x",
    permissions: { acmecorp_staging: "FULL" },
    nested: { api_key: "x", Token: "x", ok: true },
  });
  fake.resources.get("ssh")!.push({ id: 8, name: "acmecorp_deploy", publicKeys: ["x"] });
  expect(await run(args({ inspect: true }))).toBe(0);
  expect(writes()).toEqual([]);
  const inspected = JSON.parse(output.join("\n")) as Record<string, unknown[]>;
  expect(Object.keys(inspected)).toEqual(["ssh", "database", "database/user", "site", "service"]);
  expect(inspected["database/user"]).toEqual([
    {
      id: 7,
      name: "<account>_staging",
      permissions: { "<account>_staging": "FULL" },
      nested: { ok: true },
    },
  ]);
  expect(inspected.ssh).toEqual([{ id: 8, name: "<account>_deploy" }]);
});

test("parseProvisionArgs reads the flags and rejects anything else", () => {
  expect(parseProvisionArgs(["--environment", "production", "--apply"])).toEqual(
    args({ environment: "production", apply: true }),
  );
  expect(parseProvisionArgs(["--environment=staging", "--rotate-password"])).toEqual(
    args({ rotatePassword: true }),
  );
  for (const bad of [
    [],
    ["--environment", "test"],
    ["--environment", "staging", "--force"],
    ["--environment", "staging", "extra"],
    ["--environment", "staging", "--inspect", "--apply"],
  ]) {
    expect(() => parseProvisionArgs(bad)).toThrow(/Usage/);
  }
});

test("the CLI exits 2 with usage on an unknown flag and 1 on missing variables", () => {
  const script = fileURLToPath(new URL("./provision.ts", import.meta.url));
  const env = { PATH: process.env.PATH ?? "" };
  const unknown = spawnSync(process.execPath, [script, "--bogus"], { env, encoding: "utf8" });
  expect(unknown.status).toBe(2);
  expect(unknown.stderr).toMatch(/Usage/);
  const missing = spawnSync(process.execPath, [script, "--environment", "staging"], {
    env,
    encoding: "utf8",
  });
  expect(missing.status).toBe(1);
  expect(missing.stderr).toMatch(/ALWAYSDATA_API_KEY/);
});
