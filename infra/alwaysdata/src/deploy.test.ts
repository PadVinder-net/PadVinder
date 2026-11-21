import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { createAlwaysdataApi, type AlwaysdataApi } from "./api.ts";
import { deploy, pruneReleases, type DeployOptions } from "./deploy.ts";
import { redact } from "./redact.ts";
import type { Remote } from "./remote.ts";
import { startFakeAlwaysdata, type FakeAlwaysdata } from "./testing/fake-api.ts";

const oldCommit = "a".repeat(40);
const newCommit = "b".repeat(40);
const oldRelease = "20270301T190000Z-aaaaaaa";
const newRelease = "20270301T200000Z-bbbbbbb";
const envDir = "padvinder/staging";

/** The server side of a deploy: what the fake remote's commands read and change. */
type FakeServer = {
  envFile: boolean;
  /** Entries under releases/: release name -> commit (or "" for something not a release). */
  releases: Map<string, string>;
  /** Target of the `current` symlink. */
  current?: string;
  /** The migrate command fails with this exit code and message. */
  failMigration?: { code: number; message: string };
};

let fake: FakeAlwaysdata;
let baseApi: AlwaysdataApi;
let server: FakeServer;
let timeline: string[];
let logLines: string[];
let execCalls: { command: string; env?: Record<string, string> }[];
let releaseDir: string;
let clock: Date;
/** Commits whose health endpoint answers "degraded". */
let brokenCommits: Set<string>;

const marker = "__padvinder_";

/** Recognizes deploy's commands by their first line, `# deploy: <step> <argument>`. */
const fakeRemote: Remote = {
  async exec(command, options = {}) {
    execCalls.push({ command, env: options.env });
    const [, step = "", argument = ""] = /^# deploy: (\S+)(?: (.*))?$/m.exec(command) ?? [];
    timeline.push(`${step} ${argument}`.trim());
    const fail = (message: string): never => {
      throw new Error(`Remote command \`${command}\` failed with exit code 1: ${message}`);
    };
    switch (step) {
      case "prepare": {
        if (!server.envFile) fail(`${envDir}/.env is missing`);
        if (server.releases.has(argument)) fail(`${envDir}/releases/${argument} already exists`);
        const lines = ["welcome from a chatty shell"];
        if (server.current !== undefined) {
          lines.push(`${marker}current=${server.current}`);
          const commit = server.releases.get(server.current.replace(/^releases\//, ""));
          if (commit) lines.push(`${marker}commit=${commit}`);
        }
        return { stdout: `${lines.join("\n")}\n`, stderr: "" };
      }
      case "migrate":
        if (server.failMigration) {
          // Like the SSH remote: env values are hidden in the error as secrets.
          throw new Error(
            redact(
              `Remote command \`${command}\` failed with exit code ${server.failMigration.code}: ${server.failMigration.message}`,
              Object.values(options.env ?? {}),
            ),
          );
        }
        return { stdout: "Migrations are up to date.\n", stderr: "" };
      case "switch":
        server.current = argument;
        return { stdout: "", stderr: "" };
      case "remove":
        server.releases.delete(argument);
        return { stdout: "", stderr: "" };
      case "list": {
        const lines = [
          ...(server.current === undefined ? [] : [`${marker}current=${server.current}`]),
          ...[...server.releases.keys()].map((name) => `${marker}release=${name}`),
        ];
        return { stdout: `${lines.join("\n")}\n`, stderr: "" };
      }
      case "prune":
        for (const name of argument.split(" ")) server.releases.delete(name);
        return { stdout: "", stderr: "" };
      default:
        return fail(`unexpected command`);
    }
  },
  async writeFile() {
    throw new Error("deploy never writes files");
  },
  async upload(localDir, remoteDir, options = {}) {
    timeline.push(`upload ${remoteDir}${options.linkDest ? ` from ${options.linkDest}` : ""}`);
    const commit = /^GIT_COMMIT=(\w+)$/m.exec(
      readFileSync(join(localDir, "release.env"), "utf8"),
    )?.[1];
    server.releases.set(basename(remoteDir), commit ?? "");
  },
};

/** The health endpoint of whatever `current` points at, with a heartbeat after the clock. */
const fakeHealthFetch = (async () => {
  timeline.push("health");
  const commit = server.releases.get(server.current?.replace(/^releases\//, "") ?? "") ?? "";
  const status = brokenCommits.has(commit) ? "degraded" : "ok";
  return Response.json(
    {
      status,
      commit,
      worker: { lastHeartbeatAt: new Date(clock.getTime() + 30_000).toISOString() },
    },
    { status: status === "ok" ? 200 : 503 },
  );
}) as typeof fetch;

const recordingApi = (): AlwaysdataApi => ({
  list: async (kind) => {
    timeline.push(`list ${kind}`);
    return baseApi.list(kind);
  },
  create: baseApi.create,
  update: async (kind, id, patch) => {
    timeline.push(`update ${kind} ${id} ${JSON.stringify(patch)}`);
    return baseApi.update(kind, id, patch);
  },
  restartService: async (id) => {
    timeline.push(`restart ${id}`);
    return baseApi.restartService(id);
  },
});

const options = (overrides: Partial<DeployOptions> = {}): DeployOptions => ({
  env: "staging",
  commit: newCommit,
  releaseDir,
  api: recordingApi(),
  remote: fakeRemote,
  healthUrl: "https://staging.example",
  now: () => clock,
  log: (line) => logLines.push(line),
  health: { timeoutMs: 50, intervalMs: 5, fetch: fakeHealthFetch },
  ...overrides,
});

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected the deploy to fail");
    },
    (error: unknown) => error as Error,
  );

beforeAll(async () => {
  fake = await startFakeAlwaysdata();
  baseApi = createAlwaysdataApi({
    apiKey: "key",
    account: "acmecorp",
    baseUrl: fake.baseUrl,
    minIntervalMs: 0,
    retryDelayMs: 1,
  });
});
afterAll(() => fake.close());

beforeEach(async () => {
  fake.requests.length = 0;
  fake.resources.set("service", [
    { id: 21, annotation: "padvinder-api (staging)", is_disabled: false },
    { id: 22, annotation: "padvinder-worker (staging)", is_disabled: true },
    { id: 11, annotation: "padvinder-api (production)", is_disabled: false },
  ]);
  server = {
    envFile: true,
    releases: new Map([[oldRelease, oldCommit]]),
    current: `releases/${oldRelease}`,
  };
  timeline = [];
  logLines = [];
  execCalls = [];
  brokenCommits = new Set();
  clock = new Date("2027-03-01T20:00:00Z");
  releaseDir = await mkdtemp(join(tmpdir(), "padvinder-deploy-test-"));
  await writeFile(
    join(releaseDir, "release.env"),
    `GIT_COMMIT=${newCommit}\nMOBILE_DIST_DIR=mobile\n`,
  );
});
afterEach(() => rm(releaseDir, { recursive: true, force: true }));

test("runs upload, migrate, switch, restart, health, prune in this order", async () => {
  await deploy(options());
  expect(timeline).toEqual([
    "list service",
    `prepare ${newRelease}`,
    `upload ${envDir}/releases/${newRelease} from ${envDir}/releases/${oldRelease}`,
    `migrate ${newRelease}`,
    `switch releases/${newRelease}`,
    // The services are read again just before the restart.
    "list service",
    `update service 22 {"is_disabled":false}`,
    "restart 21",
    "restart 22",
    "health",
    "list",
  ]);
  expect(server.current).toBe(`releases/${newRelease}`);

  const migrate = execCalls.find((call) => call.command.startsWith("# deploy: migrate"));
  expect(migrate?.env).toBeUndefined();
  expect(migrate?.command).toContain(`cd -- ${envDir}/releases/${newRelease}`);
  expect(migrate?.command).toContain(
    `NODEJS_VERSION=24 timeout 600 node --env-file=release.env --env-file="$HOME/${envDir}/.env" api/dist/migrate.js migrations`,
  );
  const switchCommand = execCalls.find((call) => call.command.startsWith("# deploy: switch"));
  expect(switchCommand?.command).toContain(
    `ln -sfn -- releases/${newRelease} current.tmp && mv -T -- current.tmp current`,
  );

  // One line per step; nothing that looks like a secret or an account.
  expect(logLines.join("\n")).toMatch(/bbbbbbb/);
  for (const pattern of [/upload/i, /migrat/i, /current/i, /restart/i, /health/i, /prune/i]) {
    expect(logLines.some((line) => pattern.test(line))).toBe(true);
  }
});

test("a failed migration stops before the switch and removes the new release", async () => {
  server.failMigration = { code: 1, message: "relation already exists" };
  const error = await failureOf(deploy(options()));
  expect(error.message).toMatch(/Migrations of bbbbbbb failed.*current still points at/s);
  expect(error.message).toContain("relation already exists");
  expect(timeline).toEqual([
    "list service",
    `prepare ${newRelease}`,
    `upload ${envDir}/releases/${newRelease} from ${envDir}/releases/${oldRelease}`,
    `migrate ${newRelease}`,
    `remove ${newRelease}`,
  ]);
  expect(server.current).toBe(`releases/${oldRelease}`);
  expect([...server.releases.keys()]).toEqual([oldRelease]);
  expect(fake.requests.filter((r) => r.method !== "GET")).toEqual([]);
});

test("a migration error with a 24 in it is not garbled", async () => {
  server.failMigration = { code: 1, message: 'relation "counts_2024" already exists' };
  const error = await failureOf(deploy(options()));
  expect(error.message).toContain('relation "counts_2024" already exists');
  expect(error.message).not.toContain("***");
});

test("a migration that runs too long is stopped and reported as such", async () => {
  server.failMigration = { code: 124, message: "" };
  const error = await failureOf(deploy(options()));
  expect(error.message).toMatch(
    /^Migrations of bbbbbbb did not finish within 10 minutes and were stopped, so the deploy stopped: current still points at/,
  );
  expect(timeline.slice(-2)).toEqual([`migrate ${newRelease}`, `remove ${newRelease}`]);
  expect(server.current).toBe(`releases/${oldRelease}`);
});

test("a failed health check switches back and restarts again", async () => {
  brokenCommits.add(newCommit);
  const error = await failureOf(deploy(options()));
  expect(error.message.split("\n")[0]).toBe(
    `Deploy of bbbbbbb failed its health check and was rolled back to ${oldRelease}.`,
  );
  expect(error.message).toMatch(/HTTP 503/);
  expect(error.message).toMatch(/aaaaaaa passed its health check/);
  expect(error.message).toMatch(/database keeps the migrations of bbbbbbb/);
  expect(timeline).toEqual([
    "list service",
    `prepare ${newRelease}`,
    `upload ${envDir}/releases/${newRelease} from ${envDir}/releases/${oldRelease}`,
    `migrate ${newRelease}`,
    `switch releases/${newRelease}`,
    "list service",
    `update service 22 {"is_disabled":false}`,
    "restart 21",
    "restart 22",
    ...timeline.slice(9, timeline.indexOf(`switch releases/${oldRelease}`)),
    `switch releases/${oldRelease}`,
    "list service",
    "restart 21",
    "restart 22",
    "health",
  ]);
  expect(timeline.slice(9, timeline.indexOf(`switch releases/${oldRelease}`))).toContain("health");
  expect(server.current).toBe(`releases/${oldRelease}`);
  // The failed release stays for inspection; the next prune removes it.
  expect(server.releases.has(newRelease)).toBe(true);
});

test("a rollback that fails its health check too says so loudly", async () => {
  brokenCommits.add(newCommit);
  brokenCommits.add(oldCommit);
  const error = await failureOf(deploy(options()));
  expect(error.message.split("\n")[0]).toBe(
    `Deploy of bbbbbbb failed its health check, and the rollback to ${oldRelease} FAILED too: aaaaaaa failed its health check. staging may be down: check it now.`,
  );
  expect(error.message).not.toContain("was rolled back");
  expect(error.message).toMatch(/rollback to aaaaaaa ALSO FAILED its health check/i);
  expect(server.current).toBe(`releases/${oldRelease}`);
});

test("a rollback whose switch fails says so in the first line", async () => {
  brokenCommits.add(newCommit);
  const remote: Remote = {
    ...fakeRemote,
    exec: async (command, execOptions) => {
      if (command.startsWith(`# deploy: switch releases/${oldRelease}`)) {
        throw new Error("Remote command failed with exit code 255: connection reset");
      }
      return fakeRemote.exec(command, execOptions);
    },
  };
  const error = await failureOf(deploy(options({ remote })));
  expect(error.message.split("\n")[0]).toBe(
    `Deploy of bbbbbbb failed its health check, and the rollback to ${oldRelease} FAILED too: could not switch current back. staging may be down: check it now.`,
  );
  expect(error.message).toContain("connection reset");
});

test("the health check needs a worker heartbeat from after the restart", async () => {
  // The clock moves a minute per reading; the heartbeat (clock start + 30 s) predates the restart.
  let readings = 0;
  const start = clock.getTime();
  const error = await failureOf(
    deploy(options({ now: () => new Date(start + 60_000 * readings++) })),
  );
  expect(error.message).toContain("Deploy of bbbbbbb failed its health check");
  expect(error.message).toMatch(
    /worker heartbeat 2027-03-01T20:00:30\.000Z is not after the restart at 2027-03-01T20:01:00\.000Z/,
  );
});

test("the rollback turns on a service that Alwaysdata switched off during the failed release", async () => {
  fake.resources.get("service")![1]!.is_disabled = false;
  brokenCommits.add(newCommit);
  const recording = recordingApi();
  const isDisabled = (id: number) =>
    fake.resources.get("service")!.find((service) => service.id === id)!.is_disabled === true;
  let restarts = 0;
  const api: AlwaysdataApi = {
    ...recording,
    restartService: async (id) => {
      // Like Alwaysdata: a disabled service does not start.
      if (isDisabled(id)) throw new Error(`service ${id} is disabled`);
      await recording.restartService(id);
      // The new release crash-loops, so Alwaysdata switches the worker off after its restart.
      if (restarts++ === 1) fake.resources.get("service")![1]!.is_disabled = true;
    },
  };
  const error = await failureOf(deploy(options({ api })));
  expect(error.message).toContain(
    `Deploy of bbbbbbb failed its health check and was rolled back to ${oldRelease}`,
  );
  expect(error.message).toMatch(/aaaaaaa passed its health check/);
  expect(timeline.slice(timeline.indexOf(`switch releases/${oldRelease}`))).toEqual([
    `switch releases/${oldRelease}`,
    "list service",
    `update service 22 {"is_disabled":false}`,
    "restart 21",
    "restart 22",
    "health",
  ]);
  expect(isDisabled(22)).toBe(false);
});

test("the restart time for the heartbeat is taken between the API and the worker restart", async () => {
  await deploy(
    options({
      now: () => {
        timeline.push("now");
        return clock;
      },
    }),
  );
  const restart = timeline.indexOf("restart 21");
  expect(timeline.slice(restart, restart + 3)).toEqual(["restart 21", "now", "restart 22"]);
});

test("a failed restart after the switch rolls back too", async () => {
  fake.resources.get("service")![1]!.is_disabled = false;
  const recording = recordingApi();
  let restarts = 0;
  const api: AlwaysdataApi = {
    ...recording,
    restartService: async (id) => {
      // The first restart fails as it would after three 5xx answers.
      if (restarts++ === 0) {
        timeline.push(`restart ${id} failed`);
        throw new Error(`POST /v1/service/${id}/restart/ failed with 503`);
      }
      return recording.restartService(id);
    },
  };
  const error = await failureOf(deploy(options({ api })));
  expect(error.message).toContain(
    `Deploy of bbbbbbb failed while restarting the services and was rolled back to ${oldRelease}`,
  );
  expect(server.current).toBe(`releases/${oldRelease}`);
  expect(error.message).toContain("failed with 503");
  expect(timeline.slice(-8)).toEqual([
    `switch releases/${newRelease}`,
    "list service",
    "restart 21 failed",
    `switch releases/${oldRelease}`,
    "list service",
    "restart 21",
    "restart 22",
    "health",
  ]);
});

test("a failed upload removes the partial release and changes nothing", async () => {
  const remote: Remote = {
    ...fakeRemote,
    upload: async (localDir, remoteDir, uploadOptions) => {
      await fakeRemote.upload(localDir, remoteDir, uploadOptions);
      throw new Error("rsync failed with exit code 12: connection lost");
    },
  };
  const error = await failureOf(deploy(options({ remote })));
  expect(error.message).toMatch(/Upload of bbbbbbb failed.*current still points at/s);
  expect(error.message).toContain("connection lost");
  expect(timeline.slice(-2)).toEqual([
    `upload ${envDir}/releases/${newRelease} from ${envDir}/releases/${oldRelease}`,
    `remove ${newRelease}`,
  ]);
  expect([...server.releases.keys()]).toEqual([oldRelease]);
  expect(server.current).toBe(`releases/${oldRelease}`);
});

test("a failed switch restarts nothing and makes sure current stays on the old release", async () => {
  const remote: Remote = {
    ...fakeRemote,
    exec: async (command, execOptions) => {
      const result = await fakeRemote.exec(command, execOptions);
      // The switch happened, but the connection dropped before the answer.
      if (command.startsWith(`# deploy: switch releases/${newRelease}`)) {
        throw new Error("Remote command failed with exit code 255: connection reset");
      }
      return result;
    },
  };
  const error = await failureOf(deploy(options({ remote })));
  expect(error.message).toMatch(/Switching current to .* failed.*no service was restarted/s);
  expect(timeline.slice(-2)).toEqual([
    `switch releases/${newRelease}`,
    `switch releases/${oldRelease}`,
  ]);
  expect(server.current).toBe(`releases/${oldRelease}`);
  expect(fake.requests.filter((r) => r.method !== "GET")).toEqual([]);
});

test("the first deploy (no previous release) fails without trying to roll back", async () => {
  server.releases.clear();
  server.current = undefined;
  brokenCommits.add(newCommit);
  const error = await failureOf(deploy(options()));
  expect(error.message).toMatch(
    /Deploy of bbbbbbb failed its health check\. There is no previous release to roll back to/,
  );
  expect(timeline.slice(0, 3)).toEqual([
    "list service",
    `prepare ${newRelease}`,
    `upload ${envDir}/releases/${newRelease}`,
  ]);
  expect(timeline.filter((step) => step.startsWith("switch"))).toEqual([
    `switch releases/${newRelease}`,
  ]);
  expect(timeline.filter((step) => step.startsWith("restart"))).toEqual([
    "restart 21",
    "restart 22",
  ]);
  expect(server.current).toBe(`releases/${newRelease}`);
});

test("a first deploy that passes needs no previous release", async () => {
  server.releases.clear();
  server.current = undefined;
  await deploy(options());
  expect(server.current).toBe(`releases/${newRelease}`);
  expect(logLines.join("\n")).toMatch(/first deploy/i);
});

test("prune keeps five releases and never the current target", async () => {
  const names = [
    "20270101T000000Z-1111111",
    "20270102T000000Z-2222222",
    "20270103T000000Z-3333333",
    "20270104T000000Z-4444444",
    "20270105T000000Z-5555555",
    "20270106T000000Z-6666666",
    "20270107T000000Z-7777777",
    "20270108T000000Z-8888888",
  ];
  server.releases = new Map([
    ...names.map((name): [string, string] => [name, name.slice(-7).repeat(6).slice(0, 40)]),
    ["notes", ""],
    ["20270101T000000Z-1111111.bak", ""],
  ]);
  // Someone switched back to the oldest release by hand.
  server.current = `releases/${names[0]}`;
  await pruneReleases({
    env: "staging",
    remote: fakeRemote,
    keepReleases: 5,
    log: (line) => logLines.push(line),
  });
  expect([...server.releases.keys()].sort()).toEqual(
    [names[0]!, ...names.slice(3), "notes", "20270101T000000Z-1111111.bak"].sort(),
  );
  expect(timeline).toEqual(["list", `prune ${names[2]} ${names[1]}`]);
});

test("prune removes nothing when it cannot read current", async () => {
  server.releases = new Map(
    [1, 2, 3, 4, 5, 6, 7].map((day): [string, string] => [
      `2027010${day}T000000Z-${String(day).repeat(7)}`,
      String(day).repeat(40),
    ]),
  );
  server.current = undefined;
  await pruneReleases({
    env: "staging",
    remote: fakeRemote,
    keepReleases: 5,
    log: (line) => logLines.push(line),
  });
  expect(server.releases.size).toBe(7);
  expect(timeline).toEqual(["list"]);
  expect(logLines.join("\n")).toMatch(/current/);
});

test("prune refuses to keep fewer than one release", async () => {
  await expect(
    pruneReleases({ env: "staging", remote: fakeRemote, keepReleases: 0, log: () => {} }),
  ).rejects.toThrow(/at least 1/);
  expect(timeline).toEqual([]);
});

test("a deploy prunes the oldest releases", async () => {
  server.releases = new Map(
    ["20270225", "20270226", "20270227", "20270228", "20270301"].map((day, i) => [
      `${day}T120000Z-${String(i).repeat(7)}`,
      String(i).repeat(40),
    ]),
  );
  server.current = "releases/20270301T120000Z-4444444";
  await deploy(options());
  expect([...server.releases.keys()].sort()).toEqual([
    "20270226T120000Z-1111111",
    "20270227T120000Z-2222222",
    "20270228T120000Z-3333333",
    "20270301T120000Z-4444444",
    newRelease,
  ]);
});

test("refuses a release whose GIT_COMMIT differs from the commit", async () => {
  await writeFile(join(releaseDir, "release.env"), `GIT_COMMIT=${oldCommit}\n`);
  await expect(deploy(options())).rejects.toThrow(
    /release\.env names commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, not bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/,
  );
  expect(timeline).toEqual([]);
});

test("refuses a commit that is not a full SHA", async () => {
  await expect(deploy(options({ commit: "bbbbbbb" }))).rejects.toThrow(/40/);
  expect(timeline).toEqual([]);
});

test("refuses to overwrite an existing release", async () => {
  server.releases.set(newRelease, newCommit);
  await expect(deploy(options())).rejects.toThrow(/already exists/);
  expect(timeline).toEqual(["list service", `prepare ${newRelease}`]);
});

test("refuses to start without the env file", async () => {
  server.envFile = false;
  await expect(deploy(options())).rejects.toThrow(/\.env is missing/);
  expect(timeline).toEqual(["list service", `prepare ${newRelease}`]);
});

test("refuses to start when a service is missing", async () => {
  fake.resources.set("service", [{ id: 21, annotation: "padvinder-api (staging)" }]);
  await expect(deploy(options())).rejects.toThrow(/padvinder-worker \(staging\)/);
  expect(timeline).toEqual(["list service"]);
});

test("refuses a current link that points outside the releases", async () => {
  server.current = "/srv/elsewhere";
  await expect(deploy(options())).rejects.toThrow(/current points at "\/srv\/elsewhere"/);
  expect(timeline).toEqual(["list service", `prepare ${newRelease}`]);
});
