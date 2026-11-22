import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { JOB_RULES, jobsFor, matches } from "./ci-jobs.ts";

const root = join(import.meta.dirname, "../..");

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
  test("runs every job when no paths are known", () => {
    expect(jobsFor([])).toEqual({ visual: true, e2e: true, release: true });
    expect(jobsFor(["", "  "])).toEqual({ visual: true, e2e: true, release: true });
  });

  test("runs only check and scan for documentation", () => {
    expect(
      jobsFor(["docs/superpowers/plans/2026-11-22-login.md", "AGENTS.md", "README.md"]),
    ).toEqual({ visual: false, e2e: false, release: false });
  });

  test("skips the visual tests when packages/ui is untouched", () => {
    // The files of pull request 14.
    expect(
      jobsFor([
        "AGENTS.md",
        "apps/api/src/realtime/notification-hub.test.ts",
        "docker-compose.yml",
        "packages/db/src/migrate.test.ts",
        "packages/db/src/testing.test.ts",
        "packages/db/src/testing.ts",
        "scripts/teardown-workspace.sh",
      ]),
    ).toEqual({ visual: false, e2e: true, release: true });
  });

  test("runs only the visual tests for a story or a screenshot", () => {
    expect(jobsFor(["packages/ui/src/components/health-status.stories.tsx"])).toEqual({
      visual: true,
      e2e: false,
      release: false,
    });
    expect(
      jobsFor(["packages/ui/src/__screenshots__/stories.visual.test.tsx/a-chromium-linux.png"]),
    ).toEqual({ visual: true, e2e: false, release: false });
  });

  test("runs every job for a UI component", () => {
    expect(jobsFor(["packages/ui/src/components/health-status.tsx"])).toEqual({
      visual: true,
      e2e: true,
      release: true,
    });
  });

  test("runs the visual tests for a contract, which the stories render", () => {
    expect(jobsFor(["packages/contracts/src/health.ts"]).visual).toBe(true);
  });

  test("skips everything but check and scan for unit tests", () => {
    expect(jobsFor(["apps/api/src/routes/health.test.ts", "scripts/lib/a.test.ts"])).toEqual({
      visual: false,
      e2e: false,
      release: false,
    });
  });

  test("runs the e2e tests, not the release, for an end-to-end test", () => {
    expect(jobsFor(["e2e/mobile-system-status.spec.ts"])).toEqual({
      visual: false,
      e2e: true,
      release: false,
    });
    expect(jobsFor(["playwright.config.ts"]).e2e).toBe(true);
  });

  test("runs the release, not the e2e tests, for the release build", () => {
    for (const path of [
      ".github/workflows/build-release.yml",
      "infra/container/Dockerfile",
      "scripts/build-release.sh",
      "scripts/smoke-test-image.sh",
    ]) {
      expect(jobsFor([path]), path).toEqual({ visual: false, e2e: false, release: true });
    }
  });

  test("runs both for the env loader, which the release build and Playwright import", () => {
    expect(jobsFor(["scripts/load-env.ts"])).toEqual({
      visual: false,
      e2e: true,
      release: true,
    });
  });

  test("leaves the deploy scripts to the Deploy test workflow", () => {
    expect(
      jobsFor([
        "infra/alwaysdata/src/deploy.ts",
        ".github/workflows/deploy.yml",
        ".github/actions/alwaysdata-credentials/action.yml",
      ]),
    ).toEqual({ visual: false, e2e: false, release: false });
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
      expect(jobsFor([path]), path).toEqual({ visual: true, e2e: true, release: true });
    }
  });

  test("runs every job for a path no rule knows, except the visual tests", () => {
    expect(jobsFor(["apps/worker/src/new-job.ts"])).toEqual({
      visual: false,
      e2e: true,
      release: true,
    });
    expect(jobsFor(["some-new-config.json"])).toEqual({
      visual: false,
      e2e: true,
      release: true,
    });
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
