import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { createAlwaysdataApi, type AlwaysdataApi } from "../api.ts";
import type { InfraConfig } from "../config.ts";
import type { Remote } from "../remote.ts";
import { startFakeAlwaysdata, type FakeAlwaysdata } from "../testing/fake-api.ts";
import { parseDeployArgs, runDeploy, type DeployArgs } from "./deploy.ts";

const run = promisify(execFile);
const commit = "c".repeat(40);
const apiKey = "api/key+value";
const config: InfraConfig = {
  environment: "staging",
  account: "acmecorp",
  apiKey,
  ssh: {
    host: "ssh-acmecorp.alwaysdata.net",
    user: "acmecorp_deploy",
    keyFile: "/nonexistent/key",
    knownHostsFile: "/nonexistent/known_hosts",
  },
};

let fake: FakeAlwaysdata;
let api: AlwaysdataApi;
let workDir: string;
let output: string[];
let remoteCalls: string[];
let uploadedFrom: string | undefined;

const remote: Remote = {
  exec: async (command) => {
    remoteCalls.push(command);
    throw new Error(`Permission denied for ${config.account}_deploy (key ${apiKey})`);
  },
  writeFile: async () => {
    throw new Error("not used");
  },
  upload: async (localDir) => {
    uploadedFrom = localDir;
  },
};

/** Packs `release/release.env` with the given commit, as the release build does. */
async function makeTarball(releaseCommit: string): Promise<string> {
  const source = join(workDir, "source");
  await mkdir(join(source, "release"), { recursive: true });
  await writeFile(join(source, "release/release.env"), `GIT_COMMIT=${releaseCommit}\n`);
  const tarball = join(workDir, "padvinder-release.tar.gz");
  await run("tar", ["-czf", tarball, "-C", source, "release"]);
  return tarball;
}

const args = (tarball: string, overrides: Partial<DeployArgs> = {}): DeployArgs => ({
  environment: "staging",
  tarball,
  commit,
  ...overrides,
});

const deployWith = (deployArgs: DeployArgs) =>
  runDeploy({
    args: deployArgs,
    config,
    api,
    remote: () => remote,
    print: (line) => output.push(line),
    health: { timeoutMs: 10, intervalMs: 5 },
  });

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
beforeEach(async () => {
  fake.requests.length = 0;
  fake.resources.set("service", [
    { id: 1, annotation: "padvinder-api (staging)" },
    { id: 2, annotation: "padvinder-worker (staging)" },
  ]);
  workDir = await mkdtemp(join(tmpdir(), "padvinder-deploy-cli-"));
  output = [];
  remoteCalls = [];
  uploadedFrom = undefined;
});
afterEach(() => rm(workDir, { recursive: true, force: true }));

test("refuses a tarball whose GIT_COMMIT differs from --commit", async () => {
  const tarball = await makeTarball("d".repeat(40));
  expect(await deployWith(args(tarball))).toBe(1);
  expect(output.join("\n")).toMatch(/release\.env names commit d{40}, not c{40}/);
  expect(fake.requests).toEqual([]);
  expect(remoteCalls).toEqual([]);
});

test("unpacks the tarball, deploys from it and removes the unpacked copy", async () => {
  const tarball = await makeTarball(commit);
  const before = await readdir(tmpdir());
  expect(await deployWith(args(tarball))).toBe(1);
  // It got as far as the server, which refused.
  expect(remoteCalls).toHaveLength(1);
  expect(uploadedFrom).toBeUndefined();
  const leftover = (await readdir(tmpdir())).filter(
    (name) => name.startsWith("padvinder-release-") && !before.includes(name),
  );
  expect(leftover).toEqual([]);
});

test("output never contains the API key or the account", async () => {
  const tarball = await makeTarball(commit);
  expect(await deployWith(args(tarball))).toBe(1);
  const text = output.join("\n");
  expect(text).toMatch(/Permission denied for <account>_deploy/);
  expect(text).not.toContain(apiKey);
  expect(text).not.toContain(config.account);
});

test("a tarball without release/ is refused", async () => {
  const empty = join(workDir, "empty");
  await mkdir(empty);
  await writeFile(join(empty, "other.txt"), "x");
  const tarball = join(workDir, "bad.tar.gz");
  await run("tar", ["-czf", tarball, "-C", empty, "other.txt"]);
  expect(await deployWith(args(tarball))).toBe(1);
  expect(output.join("\n")).toMatch(/no release\/ directory/);
  expect(fake.requests).toEqual([]);
});

test("parseDeployArgs reads the flags and rejects anything else", () => {
  expect(
    parseDeployArgs(["--environment", "production", "--tarball", "x.tar.gz", "--commit", commit]),
  ).toEqual({ environment: "production", tarball: "x.tar.gz", commit });
  expect(
    parseDeployArgs([
      "--environment=staging",
      "--tarball=x.tar.gz",
      `--commit=${commit}`,
      "--health-url=http://localhost:4100",
    ]),
  ).toEqual({
    environment: "staging",
    tarball: "x.tar.gz",
    commit,
    healthUrl: "http://localhost:4100",
  });
  for (const bad of [
    [],
    ["--environment", "test", "--tarball", "x", "--commit", commit],
    ["--environment", "staging", "--commit", commit],
    ["--environment", "staging", "--tarball", "x"],
    ["--environment", "staging", "--tarball", "x", "--commit", "abc1234"],
    ["--environment", "staging", "--tarball", "x", "--commit", commit.toUpperCase()],
    ["--environment", "staging", "--tarball", "x", "--commit", commit, "--health-url", "ftp://x"],
    ["--environment", "staging", "--tarball", "x", "--commit", commit, "extra"],
  ]) {
    expect(() => parseDeployArgs(bad)).toThrow(/Usage/);
  }
});

test("the CLI exits 2 with usage on an unknown flag and 1 on missing variables", () => {
  const script = fileURLToPath(new URL("./deploy.ts", import.meta.url));
  const env = { PATH: process.env.PATH ?? "" };
  const unknown = spawnSync(process.execPath, [script, "--bogus"], { env, encoding: "utf8" });
  expect(unknown.status).toBe(2);
  expect(unknown.stderr).toMatch(/Usage/);
  const missing = spawnSync(
    process.execPath,
    [script, "--environment", "staging", "--tarball", "x.tar.gz", "--commit", commit],
    { env, encoding: "utf8" },
  );
  expect(missing.status).toBe(1);
  expect(missing.stderr).toMatch(/ALWAYSDATA_API_KEY/);
  expect(missing.stderr).not.toMatch(/DATABASE_PASSWORD/);
});
