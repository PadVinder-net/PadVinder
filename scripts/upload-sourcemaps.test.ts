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
    `#!/usr/bin/env bash\nprintf '%s\\n' "ARGS $*" "ORG \${SENTRY_ORG:-}" >> "${record}"\necho "uploaded"\n`,
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

test("passes the organization to sentry-cli by environment only, and never prints it", async () => {
  const output = upload({ SENTRY_AUTH_TOKEN: "token-marker", SENTRY_ORG: ORG });
  const calls = await readFile(record, "utf8");
  const run = calls.split("\n").find((line) => line.startsWith("ARGS run "));
  expect(run, calls).toContain("sourcemaps upload --project padvinder");
  expect(run).toContain("-e SENTRY_ORG");
  expect(run).not.toContain(ORG);
  expect(run).not.toContain("token-marker");
  // The fake docker saw the slug in its environment, as sentry-cli would.
  expect(calls).toContain(`ORG ${ORG}`);
  expect(output).not.toContain(ORG);
});
