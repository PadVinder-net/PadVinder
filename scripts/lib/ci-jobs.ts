// Decides which CI jobs a pull request needs, from the paths it changes. CI runs `check` and
// `scan` on every pull request; the jobs below can skip. A skipped job still reports as a
// passing required check.
//
// A pattern is one of:
//   "dir/"      every path under that directory
//   "*.ext"     every path ending in ".ext", in any directory
//   "path"      exactly that path
//
// When in doubt, a job runs: an unknown path runs every job that lists no `skip` for it.

export const CI_JOBS = ["visual", "e2e", "release", "deploy-test"] as const;
export type CiJob = (typeof CI_JOBS)[number];

type JobRule =
  /** Runs only when a changed path matches one of these. */
  | { only: readonly string[] }
  /** Runs unless every changed path matches `skip`; `run` wins over `skip`. */
  | { run: readonly string[]; skip: readonly string[] };

/** A change to one of these runs every job: the tool chain, the dependencies, CI itself. */
export const RUN_ALL: readonly string[] = [
  ".github/workflows/ci.yml",
  ".github/actions/setup/",
  "scripts/ci-changes.ts",
  "scripts/lib/ci-jobs.ts",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".node-version",
  "tsconfig.base.json",
];

/** Changes that affect neither the apps nor how they are built or run. */
const NOT_APP_CODE: readonly string[] = [
  "docs/",
  "*.md",
  "LICENSE",
  "*.test.ts",
  "*.test.tsx",
  "*.stories.tsx",
  "packages/ui/src/__screenshots__/",
  ".editorconfig",
  ".gitignore",
  ".oxlintrc.json",
  ".oxfmtrc.json",
  ".env.example",
  "docker-compose.yml",
  "vitest.config.ts",
  "orca.yaml",
];

export const JOB_RULES: Record<CiJob, JobRule> = {
  // The stories and what they render. Keep in step with the workspace dependencies of
  // packages/ui (a test checks this).
  visual: {
    only: ["packages/ui/", "packages/contracts/", "scripts/visual-tests.sh"],
  },
  e2e: {
    run: ["scripts/load-env.ts"],
    skip: [...NOT_APP_CODE, ".github/", "infra/", "scripts/"],
  },
  release: {
    run: [
      ".github/workflows/build-release.yml",
      "infra/container/",
      "scripts/build-release.sh",
      "scripts/smoke-test-image.sh",
      "scripts/load-env.ts",
    ],
    skip: [...NOT_APP_CODE, ".github/", "infra/", "scripts/", "e2e/", "playwright.config.ts"],
  },
  // The deploy scripts over SSH against a fake host, with the release tarball, and the
  // credentials action. It deploys what release builds, so it also runs release (jobsFor).
  "deploy-test": {
    only: [
      "infra/",
      "scripts/build-release.sh",
      "scripts/deploy-current.ts",
      "scripts/lib/deploy-current.ts",
      "apps/api/src/migrate.ts",
      "apps/api/src/main.ts",
      "apps/worker/src/main.ts",
      "packages/db/src/migrate.ts",
      ".github/workflows/deploy.yml",
      ".github/workflows/provision.yml",
      ".github/workflows/staging-services.yml",
      ".github/workflows/build-release.yml",
      ".github/actions/alwaysdata-credentials/",
    ],
  },
};

export function matches(path: string, pattern: string): boolean {
  if (pattern.endsWith("/")) return path.startsWith(pattern);
  if (pattern.startsWith("*.")) return path.endsWith(pattern.slice(1));
  return path === pattern;
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matches(path, pattern));
}

function needs(rule: JobRule, path: string): boolean {
  if (matchesAny(path, RUN_ALL)) return true;
  if ("only" in rule) return matchesAny(path, rule.only);
  return matchesAny(path, rule.run) || !matchesAny(path, rule.skip);
}

/** Which jobs to run for these changed paths. No paths (nothing known) runs every job. */
export function jobsFor(changedPaths: readonly string[]): Record<CiJob, boolean> {
  const paths = changedPaths.map((path) => path.trim()).filter((path) => path !== "");
  const jobs = Object.fromEntries(
    CI_JOBS.map((job) => [
      job,
      paths.length === 0 || paths.some((path) => needs(JOB_RULES[job], path)),
    ]),
  ) as Record<CiJob, boolean>;
  if (jobs["deploy-test"]) jobs.release = true;
  return jobs;
}
