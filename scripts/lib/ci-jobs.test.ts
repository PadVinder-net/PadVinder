import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { deployPathsIgnore } from "./deploy-current.ts";
import { CI_JOBS, JOB_RULES, jobsFor, matches } from "./ci-jobs.ts";

const root = join(import.meta.dirname, "../..");

/** The jobs that run for these changed paths. */
function running(paths: string[]): string[] {
  const jobs = jobsFor(paths);
  return CI_JOBS.filter((job) => jobs[job]);
}

describe("matches", () => {
  test("a directory pattern matches everything below it", () => {
    expect(matches("packages/ui/src/index.ts", "packages/ui/")).toBe(true);
    expect(matches("packages/ui-kit/index.ts", "packages/ui/")).toBe(false);
  });

  test("an extension pattern matches in any directory", () => {
    expect(matches("README.md", "*.md")).toBe(true);
    expect(matches("docs/plans/a.md", "*.md")).toBe(true);
    expect(matches("docs/a.mdx", "*.md")).toBe(false);
  });

  test("any other pattern is an exact path", () => {
    expect(matches("package.json", "package.json")).toBe(true);
    expect(matches("apps/api/package.json", "package.json")).toBe(false);
  });
});

describe("jobsFor", () => {
  test("prints one boolean per job", () => {
    expect(jobsFor(["docs/a.md"])).toEqual({
      visual: false,
      e2e: false,
      release: false,
      "deploy-test": false,
    });
  });

  test("runs every job when no paths are known", () => {
    expect(running([])).toEqual([...CI_JOBS]);
    expect(running(["", "  "])).toEqual([...CI_JOBS]);
  });

  test("runs only check and scan for documentation", () => {
    expect(
      running(["docs/superpowers/plans/2026-11-22-login.md", "AGENTS.md", "README.md"]),
    ).toEqual([]);
  });

  test("runs only check and scan for the Orca worktree hooks", () => {
    expect(running(["orca.yaml"])).toEqual([]);
  });

  test("skips the visual tests when packages/ui is untouched", () => {
    // The files of pull request 14.
    expect(
      running([
        "AGENTS.md",
        "apps/api/src/realtime/notification-hub.test.ts",
        "docker-compose.yml",
        "packages/db/src/migrate.test.ts",
        "packages/db/src/testing.test.ts",
        "packages/db/src/testing.ts",
        "scripts/teardown-workspace.sh",
      ]),
    ).toEqual(["e2e", "release"]);
  });

  test("runs only the visual tests for a story or a screenshot", () => {
    expect(running(["packages/ui/src/components/health-status.stories.tsx"])).toEqual(["visual"]);
    expect(
      running(["packages/ui/src/__screenshots__/stories.visual.test.tsx/a-chromium-linux.png"]),
    ).toEqual(["visual"]);
  });

  test("runs visual, e2e and release for a UI component", () => {
    expect(running(["packages/ui/src/components/health-status.tsx"])).toEqual([
      "visual",
      "e2e",
      "release",
    ]);
  });

  test("runs the visual tests for a contract, which the stories render", () => {
    expect(running(["packages/contracts/src/health.ts"])).toContain("visual");
  });

  test("skips everything but check and scan for unit tests", () => {
    expect(running(["apps/api/src/routes/health.test.ts", "scripts/lib/a.test.ts"])).toEqual([]);
  });

  test("runs the e2e tests, not the release, for an end-to-end test", () => {
    expect(running(["e2e/mobile-system-status.spec.ts"])).toEqual(["e2e"]);
    expect(running(["playwright.config.ts"])).toEqual(["e2e"]);
  });

  test("runs the release, not the e2e tests, for the image smoke test", () => {
    expect(running(["scripts/smoke-test-image.sh"])).toEqual(["release"]);
  });

  test("runs e2e and release for the env loader, which the release build and Playwright import", () => {
    expect(running(["scripts/load-env.ts"])).toEqual(["e2e", "release"]);
  });

  test("runs the deploy test, with the release it deploys, for the deploy path", () => {
    for (const path of [
      "infra/alwaysdata/src/deploy.ts",
      "infra/container/Dockerfile",
      "scripts/build-release.sh",
      ".github/workflows/deploy.yml",
      ".github/workflows/build-release.yml",
      ".github/actions/alwaysdata-credentials/action.yml",
      "scripts/deploy-current.ts",
      "scripts/lib/deploy-current.ts",
    ]) {
      expect(running([path]), path).toEqual(["release", "deploy-test"]);
    }
  });

  test("runs the deploy test for the entry points the server starts", () => {
    for (const path of [
      "apps/api/src/migrate.ts",
      "apps/api/src/main.ts",
      "apps/api/src/run.ts",
      "apps/worker/src/main.ts",
      "packages/db/src/migrate.ts",
    ]) {
      expect(running([path]), path).toEqual(["e2e", "release", "deploy-test"]);
    }
  });

  test("runs every job for the dependencies, the tool chain and CI itself", () => {
    for (const path of [
      "pnpm-lock.yaml",
      "package.json",
      "pnpm-workspace.yaml",
      ".node-version",
      ".github/workflows/ci.yml",
      ".github/actions/setup/action.yml",
      "scripts/lib/ci-jobs.ts",
    ]) {
      expect(running([path]), path).toEqual([...CI_JOBS]);
    }
  });

  test("runs e2e and release for a path no rule knows", () => {
    expect(running(["apps/worker/src/new-job.ts"])).toEqual(["e2e", "release"]);
    expect(running(["some-new-config.json"])).toEqual(["e2e", "release"]);
  });
});

test("the visual tests run for every workspace package that packages/ui depends on", async () => {
  const manifest = JSON.parse(await readFile(join(root, "packages/ui/package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const workspacePackages = Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })
    .filter(([, version]) => version.startsWith("workspace:"))
    .map(([name]) => name);
  expect(workspacePackages.length).toBeGreaterThan(0);

  const rule = JOB_RULES.visual;
  if (!("only" in rule)) throw new Error("The visual job is expected to list what it needs.");
  for (const name of workspacePackages) {
    const dir = `packages/${name.replace("@padvinder/", "")}/`;
    expect(rule.only, `${name} (${dir})`).toContain(dir);
  }
});

test("Deploy ignores only paths that cannot change the release", async () => {
  const workflow = await readFile(join(root, ".github/workflows/deploy.yml"), "utf8");
  const patterns = deployPathsIgnore(workflow);
  for (const pattern of patterns) {
    // A made-up path that the GitHub pattern matches, in a subdirectory where it can be.
    const example = pattern.replace("/**", "/a/b.ts").replace("**", "apps/api/src/x");
    expect(jobsFor([example]).release, `${pattern} (${example})`).toBe(false);
  }
});
