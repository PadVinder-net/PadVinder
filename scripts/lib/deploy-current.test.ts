import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  changesRelease,
  checkDeploy,
  decideDeploy,
  deployPathsIgnore,
  matchesFilterPattern,
} from "./deploy-current.ts";

const root = join(import.meta.dirname, "../..");

describe("deployPathsIgnore", () => {
  test("reads the paths-ignore list of the real deploy.yml", async () => {
    const workflow = await readFile(join(root, ".github/workflows/deploy.yml"), "utf8");
    const patterns = deployPathsIgnore(workflow);
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns).toContain("docs/**");
    expect(patterns).toContain("**.md");
    for (const pattern of patterns) {
      expect(() => matchesFilterPattern("a.ts", pattern), pattern).not.toThrow();
    }
  });

  test("throws when there is no list", () => {
    expect(() => deployPathsIgnore("on:\n  push:\n    branches:\n      - main\n")).toThrow();
  });
});

describe("matchesFilterPattern", () => {
  test("** matches any characters, including a slash", () => {
    expect(matchesFilterPattern("README.md", "**.md")).toBe(true);
    expect(matchesFilterPattern("apps/api/README.md", "**.md")).toBe(true);
    expect(matchesFilterPattern("docs/a/b.ts", "docs/**")).toBe(true);
    expect(matchesFilterPattern("apps/api/src/x.test.ts", "**.test.ts")).toBe(true);
  });

  test("the whole path must match", () => {
    expect(matchesFilterPattern("LICENSE", "LICENSE")).toBe(true);
    expect(matchesFilterPattern("apps/LICENSE", "LICENSE")).toBe(false);
    expect(matchesFilterPattern("docs", "docs/**")).toBe(false);
  });

  test("* does not match a slash", () => {
    expect(matchesFilterPattern("a/b.ts", "*/b.ts")).toBe(true);
    expect(matchesFilterPattern("a/c/b.ts", "*/b.ts")).toBe(false);
  });

  test("other regular expression characters are literal", () => {
    expect(matchesFilterPattern("a.ts", "a.ts")).toBe(true);
    expect(matchesFilterPattern("axts", "a.ts")).toBe(false);
  });

  test("throws for characters GitHub gives a meaning that is not supported", () => {
    for (const pattern of ["a?.ts", "a+.ts", "[ab].ts", "a].ts", "!a.ts"]) {
      expect(() => matchesFilterPattern("a.ts", pattern), pattern).toThrow();
    }
  });

  test("no deploy pattern matches an app source file", async () => {
    const workflow = await readFile(join(root, ".github/workflows/deploy.yml"), "utf8");
    const patterns = deployPathsIgnore(workflow);
    expect(patterns.some((p) => matchesFilterPattern("apps/api/src/main.ts", p))).toBe(false);
  });
});

describe("changesRelease", () => {
  const patterns = ["docs/**", "**.md"];

  test("is true when one path is not ignored", () => {
    expect(changesRelease(["docs/a.ts", "apps/api/src/main.ts"], patterns)).toBe(true);
  });

  test("is false when every path is ignored", () => {
    expect(changesRelease(["docs/a.ts", "AGENTS.md"], patterns)).toBe(false);
  });

  test("is false for a commit that changes no file", () => {
    expect(changesRelease([], patterns)).toBe(false);
  });
});

describe("decideDeploy", () => {
  const patterns = ["docs/**", "**.md"];
  const ignored = (sha: string) => ({ sha, paths: ["docs/superpowers/plans/x.md"] });
  const changing = (sha: string) => ({ sha, paths: ["apps/api/src/main.ts"] });

  test("the same commit is current", () => {
    expect(decideDeploy({ isAncestor: true, newerCommits: [], patterns })).toEqual({
      current: true,
      newerCommits: 0,
    });
  });

  test("newer commits that are all ignored leave it current", () => {
    const newerCommits = [ignored("b"), { sha: "a", paths: ["AGENTS.md"] }];
    expect(decideDeploy({ isAncestor: true, newerCommits, patterns })).toEqual({
      current: true,
      newerCommits: 2,
    });
  });

  test("a newer commit that changes the release is named", () => {
    const newerCommits = [ignored("c"), changing("b"), ignored("a")];
    expect(decideDeploy({ isAncestor: true, newerCommits, patterns })).toEqual({
      current: false,
      reason: "release-changed",
      commit: "b",
    });
  });

  test("names the newest of two commits that change the release", () => {
    const newerCommits = [changing("c"), changing("b")];
    expect(decideDeploy({ isAncestor: true, newerCommits, patterns })).toEqual({
      current: false,
      reason: "release-changed",
      commit: "c",
    });
  });

  test("a commit that is not in the history is not current", () => {
    expect(decideDeploy({ isAncestor: false, newerCommits: [ignored("a")], patterns })).toEqual({
      current: false,
      reason: "not-ancestor",
    });
  });

  test("a newer commit without files is still current", () => {
    const newerCommits = [{ sha: "a", paths: [] }];
    expect(decideDeploy({ isAncestor: true, newerCommits, patterns })).toEqual({
      current: true,
      newerCommits: 1,
    });
  });
});

describe("checkDeploy in a git repository", () => {
  const patterns = ["docs/**", "**.md"];
  let dir = "";

  function git(...args: string[]): string {
    return execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.test",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: dir, encoding: "utf8" },
    ).trim();
  }

  function commit(file: string, message: string): string {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${message}\n`);
    git("add", "-A");
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  }

  let base = "";
  let docsOne = "";
  let docsTwo = "";
  let release = "";
  let side = "";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "deploy-current-"));
    git("init", "-b", "main");
    base = commit("apps/api/main.ts", "base");
    // A side branch that main will not contain.
    git("checkout", "-b", "side");
    side = commit("apps/api/side.ts", "side");
    git("checkout", "main");
    docsOne = commit("docs/one.md", "docs one");
    docsTwo = commit("AGENTS.md", "docs two");
    release = commit("apps/api/main.ts", "release change");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("the head itself is current", () => {
    const result = checkDeploy({ cwd: dir, commit: release, head: "main", patterns });
    expect(result.decision).toEqual({ current: true, newerCommits: 0 });
    expect(result.headSha).toBe(release);
    expect(result.message).toBe(`${release} is the head of main: deploying it.`);
  });

  test("newer commits that are all ignored leave it current", () => {
    const result = checkDeploy({ cwd: dir, commit: base, head: docsTwo, patterns });
    expect(result.decision).toEqual({ current: true, newerCommits: 2 });
    expect(result.message).toContain(`main has moved on to ${docsTwo}`);
    expect(result.message).toContain("the 2 newer commits change only paths Deploy ignores");
    expect(result.message).toContain(`${base} is still the current release`);
    expect(docsOne).not.toBe(docsTwo);
  });

  test("a newer commit that changes the release is named", () => {
    const result = checkDeploy({ cwd: dir, commit: base, head: "main", patterns });
    expect(result.decision).toEqual({
      current: false,
      reason: "release-changed",
      commit: release,
    });
    expect(result.message).toContain(`${release} on main is newer than ${base}`);
  });

  test("a commit outside the history of main is not current", () => {
    const result = checkDeploy({ cwd: dir, commit: side, head: "main", patterns });
    expect(result.decision).toEqual({ current: false, reason: "not-ancestor" });
    expect(result.message).toContain(`${side} is not in the history of main (head ${release})`);
  });
});
