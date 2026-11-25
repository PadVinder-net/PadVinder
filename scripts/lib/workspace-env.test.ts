import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// scripts/lib/workspace-env.sh is sourced by the workspace scripts (bash) and, in Orca, by
// the user's shell (zsh) before a command. Each test sources it from a scratch repository
// with worktrees, outside Conductor: the environment holds only PATH and HOME.

const source = join(import.meta.dirname, "workspace-env.sh");
let dir: string;

function hasShell(shell: string): boolean {
  try {
    execFileSync(shell, ["-c", "true"]);
    return true;
  } catch {
    return false;
  }
}

const isolatedGit = {
  PATH: process.env.PATH ?? "",
  HOME: "/nonexistent",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, env: isolatedGit, stdio: "ignore" });
}

interface WorkspaceEnv {
  repoRoot: string;
  workspace: string;
  ports: number[];
  leftovers: string;
}

// Sources the script of the worktree `worktree` under `set -euo pipefail` from another directory.
function sourceIn(shell: string, worktree: string, env: Record<string, string> = {}): WorkspaceEnv {
  const script = [
    "set -euo pipefail",
    'source "$1"',
    'printf "%s\\n" "$REPO_ROOT" "$WORKSPACE" "$API_PORT" "$MOBILE_PORT" "$PORTAL_PORT" "$STORYBOOK_PORT"',
    "{ set; typeset -f; } | grep -E '^(BASE_PORT=|_workspace_env)' | tr '\\n' ' ' || true",
  ].join("\n");
  const output = execFileSync(
    shell,
    ["-c", script, shell, join(dir, worktree, "scripts/lib/workspace-env.sh")],
    { cwd: tmpdir(), env: { PATH: process.env.PATH ?? "", HOME: "/nonexistent", ...env } },
  ).toString();
  const [repoRoot = "", workspace = "", ...rest] = output.split("\n");
  return {
    repoRoot,
    workspace,
    ports: rest.slice(0, 4).map(Number),
    leftovers: rest.slice(4).join("").trim(),
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "workspace-env-"));
  const main = join(dir, "PadVinder");
  await mkdir(join(main, "scripts/lib"), { recursive: true });
  await copyFile(source, join(main, "scripts/lib/workspace-env.sh"));
  git(main, "init", "--quiet");
  git(main, "add", ".");
  git(main, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "init");
  for (const name of ["Seal-2", "orca", "fresh", "left", "right"])
    git(main, "worktree", "add", "-q", `../${name}`);
  await writeFile(join(main, ".env"), "WORKSPACE=padvinder\nAPI_PORT=4100\n");
  await writeFile(join(dir, "orca/.env"), "WORKSPACE=orca\nAPI_PORT=4110\nMOBILE_PORT=4111\n");
  // Two worktrees with the same port, as setups under the old fixed default left them.
  await writeFile(join(dir, "left/.env"), "WORKSPACE=left\nAPI_PORT=4130\n");
  await writeFile(join(dir, "right/.env"), "WORKSPACE=right\nAPI_PORT=4130\n");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.each(["bash", "zsh"].filter(hasShell))("sourced from %s", (shell) => {
  test("Conductor's name and port win", () => {
    const env = sourceIn(shell, "orca", {
      CONDUCTOR_WORKSPACE_NAME: "Caracas-v1",
      CONDUCTOR_PORT: "55110",
    });
    expect(env.workspace).toBe("caracas_v1");
    expect(env.ports).toEqual([55110, 55111, 55112, 55113]);
  });

  test("REPO_ROOT is the worktree of the script, whatever the current directory", () => {
    expect(sourceIn(shell, "Seal-2").repoRoot).toBe(join(dir, "Seal-2"));
  });

  test("without Conductor the name is the worktree's directory name, sanitized", () => {
    expect(sourceIn(shell, "Seal-2").workspace).toBe("seal_2");
  });

  test("a worktree keeps the API_PORT of its own .env", () => {
    expect(sourceIn(shell, "orca").ports).toEqual([4110, 4111, 4112, 4113]);
    expect(sourceIn(shell, "PadVinder").ports).toEqual([4100, 4101, 4102, 4103]);
  });

  test("a worktree without one takes the first block no other worktree has", () => {
    expect(sourceIn(shell, "fresh").ports).toEqual([4120, 4121, 4122, 4123]);
  });

  test("a worktree gives up a port another worktree has too", () => {
    expect(sourceIn(shell, "left").ports).toEqual([4120, 4121, 4122, 4123]);
    expect(sourceIn(shell, "right").ports).toEqual([4120, 4121, 4122, 4123]);
  });

  test("leaves no helper variables or functions behind", () => {
    expect(sourceIn(shell, "fresh").leftovers).toBe("");
  });
});
