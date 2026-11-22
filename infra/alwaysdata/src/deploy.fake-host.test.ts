// Deploys the real release tarball to the fake SSH host twice, then a third time with a
// failing health check. Needs padvinder-release.tar.gz in the repository root
// (`pnpm release:build --allow-dirty`); CI downloads it. Migrations run inside the fake host
// against a fresh, empty database on the local (or CI) PostGIS.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createAlwaysdataApi, type AlwaysdataApi } from "./api.ts";
import { deploy, pruneReleases } from "./deploy.ts";
import { shellQuote } from "./remote.ts";
import { startFakeAlwaysdata, type FakeAlwaysdata } from "./testing/fake-api.ts";
import { startFakeHost, type FakeHost } from "./testing/fake-host.ts";

const run = promisify(execFile);
const tarball = join(import.meta.dirname, "../../../padvinder-release.tar.gz");
const hasTarball = existsSync(tarball);
if (!hasTarball) {
  if (process.env.CI) throw new Error(`${tarball} is missing; the deploy test needs it in CI.`);
  console.warn(
    `Skipping the deploy fake host test: ${tarball} is missing. Build it with pnpm release:build --allow-dirty.`,
  );
}

const envDir = "padvinder/staging";
const commits = ["1".repeat(40), "2".repeat(40), "3".repeat(40), "4".repeat(40)] as const;

let host: FakeHost;
let fake: FakeAlwaysdata;
let api: AlwaysdataApi;
let healthServer: Server;
let healthUrl: string;
let workDir: string;
let releaseDir: string;
let adminUrl: string;
let databaseName: string;
/** The fresh database, as seen from inside the fake host. */
let databaseUrl: string;
/** Commits whose health endpoint answers "degraded". */
const brokenCommits = new Set<string>();
const log: string[] = [];

const psql = (url: string, sql: string) =>
  host.exec(`psql ${shellQuote(url)} -v ON_ERROR_STOP=1 -tAc ${shellQuote(sql)}`);

let originalReleaseEnv = "";
/** Patches the unpacked copy: each deploy is a release of another (made-up) commit. */
const setCommit = (commit: string) =>
  writeFile(
    join(releaseDir, "release.env"),
    originalReleaseEnv.replace(/^GIT_COMMIT=.*$/m, `GIT_COMMIT=${commit}`),
  );

const deployCommit = (commit: string, health = { timeoutMs: 10_000, intervalMs: 100 }) =>
  setCommit(commit).then(() =>
    deploy({
      env: "staging",
      commit,
      releaseDir,
      api,
      remote: host.remote,
      healthUrl,
      log: (line) => {
        log.push(line);
        console.log(`  deploy: ${line}`);
      },
      health,
    }),
  );

const releases = async () =>
  (await host.exec(`ls -1 ${envDir}/releases`)).split("\n").filter((name) => name !== "");
const currentTarget = async () => (await host.exec(`readlink ${envDir}/current`)).trim();

describe.skipIf(!hasTarball)("deploy to the fake host", () => {
  beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    if (!testDatabaseUrl)
      throw new Error("TEST_DATABASE_URL is not set; run ./scripts/setup-workspace.sh");
    host = await startFakeHost({ databaseUrlFromHost: testDatabaseUrl });

    // A fresh, empty database, created from inside the fake host.
    const url = new URL(host.databaseUrl);
    databaseName = `${decodeURIComponent(url.pathname.slice(1))}_deploy_${randomBytes(4).toString("hex")}`;
    url.pathname = "/postgres";
    adminUrl = url.toString();
    await psql(adminUrl, `create database "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    await host.remote.writeFile(`${envDir}/.env`, `DATABASE_URL=${databaseUrl}\n`, 0o600);

    workDir = await mkdtemp(join(tmpdir(), "padvinder-deploy-fake-host-"));
    await run("tar", ["-xzf", tarball, "-C", workDir]);
    releaseDir = join(workDir, "release");
    originalReleaseEnv = await readFile(join(releaseDir, "release.env"), "utf8");

    fake = await startFakeAlwaysdata();
    fake.resources.set("service", [
      { id: 1, annotation: "padvinder-api (staging)", is_disabled: false },
      // Staging may be switched off: the deploy turns it on.
      { id: 2, annotation: "padvinder-worker (staging)", is_disabled: true },
    ]);
    api = createAlwaysdataApi({
      apiKey: "test-key",
      account: "acmecorp",
      baseUrl: fake.baseUrl,
      minIntervalMs: 0,
      retryDelayMs: 1,
    });

    // Stands in for the restarted services: answers with the commit of whatever `current`
    // points at, and a fresh worker heartbeat.
    healthServer = createServer(async (req, res) => {
      if (!req.url?.startsWith("/api/health?")) {
        res.writeHead(404).end();
        return;
      }
      const releaseEnv = await host
        .exec(`cat ${envDir}/current/release.env 2>/dev/null || true`)
        .catch(() => "");
      const commit = /^GIT_COMMIT=(\w+)$/m.exec(releaseEnv)?.[1] ?? "";
      const status = commit !== "" && !brokenCommits.has(commit) ? "ok" : "degraded";
      res.writeHead(status === "ok" ? 200 : 503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status, commit, worker: { lastHeartbeatAt: new Date().toISOString() } }),
      );
    });
    await new Promise<void>((resolve) => healthServer.listen(0, "127.0.0.1", resolve));
    healthUrl = `http://127.0.0.1:${(healthServer.address() as AddressInfo).port}`;
  }, 300_000);

  afterAll(async () => {
    await new Promise((resolve) => healthServer?.close(resolve));
    await fake?.close();
    if (adminUrl && databaseName) {
      await psql(adminUrl, `drop database if exists "${databaseName}" with (force)`).catch(
        (error: unknown) => console.warn(`Could not drop ${databaseName}: ${String(error)}`),
      );
    }
    await host?.stop();
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  test("two deploys, then a third that fails its health check and is rolled back", async () => {
    const started = Date.now();
    await deployCommit(commits[0]);
    const afterFirst = Date.now();
    const [first] = await releases();
    expect(first).toMatch(/^\d{8}T\d{6}Z-1111111$/);
    expect(await currentTarget()).toBe(`releases/${first}`);
    const migrations = (
      await readdir(join(releaseDir, "migrations"), { withFileTypes: true })
    ).filter((entry) => entry.isDirectory());
    expect(
      (await psql(databaseUrl, "select count(*) from drizzle.__drizzle_migrations")).trim(),
    ).toBe(String(migrations.length));
    expect(
      fake.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`),
    ).toEqual([
      "PATCH /v1/service/2/",
      "POST /v1/service/1/restart/",
      "POST /v1/service/2/restart/",
    ]);

    await deployCommit(commits[1]);
    const afterSecond = Date.now();
    const names = await releases();
    expect(names).toHaveLength(2);
    const second = names.find((name) => name.endsWith("-2222222"));
    expect(await currentTarget()).toBe(`releases/${second}`);
    expect(await host.exec(`cat ${envDir}/current/release.env`)).toContain(
      `GIT_COMMIT=${commits[1]}`,
    );

    // The second upload hard-linked unchanged files against the first.
    const sample = (
      await host.exec(`cd ${envDir}/releases/${first} && find api/node_modules -type f | head -1`)
    ).trim();
    expect(sample).not.toBe("");
    const inode = (name: string | undefined) =>
      host.exec(`stat -c %i ${envDir}/releases/${name}/${sample}`);
    expect(await inode(second)).toBe(await inode(first));
    const envInode = (name: string | undefined) =>
      host.exec(`stat -c %i ${envDir}/releases/${name}/release.env`);
    expect(await envInode(second)).not.toBe(await envInode(first));

    brokenCommits.add(commits[2]);
    const error = await deployCommit(commits[2], { timeoutMs: 2_000, intervalMs: 100 }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    const afterThird = Date.now();
    expect(error?.message).toContain(
      `Deploy of 3333333 failed its health check and was rolled back to ${second}`,
    );
    expect(await currentTarget()).toBe(`releases/${second}`);
    expect(await host.exec(`ls -A ${envDir}`)).toBe(".env\ncurrent\nreleases\n");

    console.log(
      `  timings: first deploy ${afterFirst - started} ms, second ${afterSecond - afterFirst} ms, failed third with rollback ${afterThird - afterSecond} ms`,
    );
    console.log(`  rolled-back deploy error: ${error?.message}`);

    // A fourth deploy whose migrations cannot reach the database leaves no trace.
    const before = await releases();
    await host.remote.writeFile(
      `${envDir}/.env`,
      `DATABASE_URL=${databaseUrl.replace(/\/[^/]+$/, `/${databaseName}_missing`)}\n`,
      0o600,
    );
    const migrationError = await deployCommit(commits[3]).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    await host.remote.writeFile(`${envDir}/.env`, `DATABASE_URL=${databaseUrl}\n`, 0o600);
    expect(migrationError?.message).toMatch(/Migrations of 4444444 failed/);
    expect(migrationError?.message).toMatch(/does not exist/);
    expect(await releases()).toEqual(before);
    expect(await currentTarget()).toBe(`releases/${second}`);

    // Pruning down to one release keeps the newest (the failed third) and current's target.
    await pruneReleases({ env: "staging", remote: host.remote, keepReleases: 1, log: () => {} });
    expect(await releases()).toEqual(before.filter((name) => name !== first));
    expect(await currentTarget()).toBe(`releases/${second}`);
  }, 300_000);
});
