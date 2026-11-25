// Decides whether a commit is still the current release of main, so the production job of
// Deploy does not deploy an old release over a newer one. Plain Node.js, no dependencies.
//
// Deploy ignores pushes that change only some paths (`paths-ignore` in deploy.yml). So when
// main has moved on, the commit being deployed is still the current release as long as every
// newer commit changes only ignored paths: no Deploy run of its own would replace it.
import { execFileSync } from "node:child_process";

export type NewerCommit = { sha: string; paths: readonly string[] };

export type DeployDecision =
  /** `newerCommits` is how many newer commits there are, all of them ignored. */
  | { current: true; newerCommits: number }
  | { current: false; reason: "not-ancestor" }
  /** `commit` is the newest newer commit that changes the release. */
  | { current: false; reason: "release-changed"; commit: string };

/** The patterns of `on.push.paths-ignore` in the text of deploy.yml. */
export function deployPathsIgnore(workflow: string): string[] {
  const items = /^ {4}paths-ignore:\n((?: {6}- .*\n)+)/m.exec(workflow)?.[1];
  if (!items) throw new Error("deploy.yml has no paths-ignore under push.");
  const patterns = [...items.matchAll(/- "([^"]+)"/g)].map((match) => match[1] ?? "");
  if (patterns.length === 0) throw new Error("The paths-ignore of deploy.yml is empty.");
  return patterns;
}

/**
 * GitHub's filter pattern, the subset in use: `**` matches any characters, including `/`;
 * `*` matches any characters except `/`; everything else is literal. The whole path must match.
 */
export function matchesFilterPattern(path: string, pattern: string): boolean {
  if (/[?+[\]!]/.test(pattern)) {
    throw new Error(
      `The filter pattern "${pattern}" uses a character this check does not support.`,
    );
  }
  const source = pattern
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${source}$`).test(path);
}

/** True when any path matches none of the patterns. No paths changes nothing. */
export function changesRelease(paths: readonly string[], patterns: readonly string[]): boolean {
  return paths.some((path) => !patterns.some((pattern) => matchesFilterPattern(path, pattern)));
}

export function decideDeploy(input: {
  isAncestor: boolean;
  /** Newest first, as `git rev-list` gives them. */
  newerCommits: readonly NewerCommit[];
  patterns: readonly string[];
}): DeployDecision {
  if (!input.isAncestor) return { current: false, reason: "not-ancestor" };
  const changing = input.newerCommits.find((commit) =>
    changesRelease(commit.paths, input.patterns),
  );
  if (changing) return { current: false, reason: "release-changed", commit: changing.sha };
  return { current: true, newerCommits: input.newerCommits.length };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function lines(output: string): string[] {
  return output.split("\n").filter((line) => line !== "");
}

/** Whether `commit` is `head` or in its history. An unknown commit throws. */
export function isAncestor(cwd: string, commit: string, head: string): boolean {
  try {
    git(cwd, ["merge-base", "--is-ancestor", commit, head]);
    return true;
  } catch (error) {
    if ((error as { status?: unknown }).status === 1) return false;
    throw error;
  }
}

/**
 * The commits on the first-parent line of `head` after `commit`, newest first, each with the
 * paths it changes against its first parent: what a push of that commit to main changes.
 */
export function readNewerCommits(cwd: string, commit: string, head: string): NewerCommit[] {
  return lines(git(cwd, ["rev-list", "--first-parent", `${commit}..${head}`])).map((sha) => ({
    sha,
    paths: lines(git(cwd, ["diff", "--name-only", `${sha}^1`, sha])),
  }));
}

export function checkDeploy(input: {
  cwd: string;
  commit: string;
  head: string;
  patterns: readonly string[];
}): { decision: DeployDecision; headSha: string; message: string } {
  const { cwd, commit, head, patterns } = input;
  const headSha = git(cwd, ["rev-parse", "--verify", `${head}^{commit}`]).trim();
  const ancestor = isAncestor(cwd, commit, headSha);
  const newerCommits = ancestor ? readNewerCommits(cwd, commit, headSha) : [];
  const decision = decideDeploy({ isAncestor: ancestor, newerCommits, patterns });
  return { decision, headSha, message: describe(decision, commit, headSha) };
}

function describe(decision: DeployDecision, commit: string, headSha: string): string {
  if (decision.current) {
    if (decision.newerCommits === 0) return `${commit} is the head of main: deploying it.`;
    const n = decision.newerCommits;
    return `main has moved on to ${headSha}, but the ${n} newer ${n === 1 ? "commit" : "commits"} change only paths Deploy ignores (paths-ignore): ${commit} is still the current release. Deploying it.`;
  }
  if (decision.reason === "release-changed") {
    return `Deployed nothing: ${decision.commit} on main is newer than ${commit} and changes the release. The Deploy run of ${decision.commit} deploys it; or run Deploy by hand from main.`;
  }
  return `Deployed nothing: ${commit} is not in the history of main (head ${headSha}). Run Deploy by hand from main.`;
}
