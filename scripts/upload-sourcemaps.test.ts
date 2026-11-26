import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";

// scripts/upload-sourcemaps.sh with a fake `docker` first on PATH, which records its arguments
// and environment: the organization's slug is a secret (the Deploy workflow's logs are public),
// so it reaches sentry-cli only through the environment, never on a command line or in output.

const root = join(import.meta.dirname, "..");
const ORG = "org-slug-marker";
let bin: string;
let record: string;
let maps: string;

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "upload-sourcemaps-test-"));
  bin = join(scratch, "bin");
  maps = join(scratch, "sourcemaps");
  record = join(scratch, "docker-calls");
  await mkdir(bin);
  await mkdir(maps);
  await writeFile(
    join(bin, "docker"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "ARGS $*" "ORG \${SENTRY_ORG:-}" >> "${record}"\n[[ -n "\${FAKE_DOCKER_FAIL:-}" && "$*" == *"\${FAKE_DOCKER_FAIL}"* ]] && exit 1\necho "uploaded"\n`,
  );
  await chmod(join(bin, "docker"), 0o755);
  return () => rm(scratch, { recursive: true, force: true });
});
/** Runs the script; answers its stdout and stderr together. */
function upload(env: Record<string, string>): string {
  const result = spawnSync(join(root, "scripts/upload-sourcemaps.sh"), [maps], {
    cwd: root,
    env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: process.env.HOME ?? "/tmp", ...env },
    encoding: "utf8",
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.stdout + result.stderr;
}

async function makeMaps(...names: string[]): Promise<void> {
  await rm(maps, { recursive: true, force: true });
  await mkdir(maps);
  for (const name of names) await mkdir(join(maps, name));
  await rm(record, { force: true });
}

async function runLines(): Promise<string[]> {
  const calls = await readFile(record, "utf8");
  return calls.split("\n").filter((line) => line.startsWith("ARGS run "));
}

test("sends the server maps to padvinder-server and the browser maps to padvinder-browser", async () => {
  await makeMaps("api", "worker", "mobile", "portal");
  const output = upload({ SENTRY_AUTH_TOKEN: "token-marker", SENTRY_ORG: ORG });
  const calls = await readFile(record, "utf8");
  const runs = await runLines();
  expect(runs).toHaveLength(2);
  const [server, browser] = runs as [string, string];
  expect(server).toContain("sourcemaps upload --project padvinder-server");
  expect(server).toContain(`${maps}/api`);
  expect(server).toContain(`${maps}/worker`);
  expect(server).not.toContain(`${maps}/mobile`);
  expect(server).not.toContain(`${maps}/portal`);
  expect(browser).toContain("sourcemaps upload --project padvinder-browser");
  expect(browser).toContain(`${maps}/mobile`);
  expect(browser).toContain(`${maps}/portal`);
  expect(browser).not.toContain(`${maps}/api`);
  expect(browser).not.toContain(`${maps}/worker`);
  for (const run of runs) {
    expect(run).toContain("-e SENTRY_ORG");
    expect(run).not.toContain(ORG);
    expect(run).not.toContain("token-marker");
  }
  // The fake docker saw the slug in its environment, as sentry-cli would.
  expect(calls).toContain(`ORG ${ORG}`);
  expect(output).not.toContain(ORG);
});

test("skips a missing directory with a warning and uploads the rest", async () => {
  await makeMaps("api", "portal");
  const output = upload({ SENTRY_AUTH_TOKEN: "token-marker", SENTRY_ORG: ORG });
  const runs = await runLines();
  expect(runs).toHaveLength(2);
  expect(runs[0]).toContain(`${maps}/api`);
  expect(runs[0]).not.toContain(`${maps}/worker`);
  expect(runs[1]).toContain(`${maps}/portal`);
  expect(runs[1]).not.toContain(`${maps}/mobile`);
  expect(output).toMatch(/warning.*worker/);
  expect(output).toMatch(/warning.*mobile/);
  expect(output).not.toContain(ORG);
});

test("uploads nothing and exits 0 without a token", async () => {
  await makeMaps("api", "worker", "mobile", "portal");
  const output = upload({ SENTRY_ORG: ORG });
  await expect(readFile(record, "utf8")).rejects.toThrow();
  expect(output).toContain("SENTRY_AUTH_TOKEN is not set");
});

test("uploads the browser maps even when the server upload fails, and exits 1", async () => {
  await makeMaps("api", "worker", "mobile", "portal");
  const result = spawnSync(join(root, "scripts/upload-sourcemaps.sh"), [maps], {
    cwd: root,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? "/tmp",
      SENTRY_AUTH_TOKEN: "token-marker",
      SENTRY_ORG: ORG,
      FAKE_DOCKER_FAIL: "padvinder-server",
    },
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  const runs = await runLines();
  expect(runs).toHaveLength(2);
  expect(runs[0]).toContain("--project padvinder-server");
  expect(runs[1]).toContain("--project padvinder-browser");
});
