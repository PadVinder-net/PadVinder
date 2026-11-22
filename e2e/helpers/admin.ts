import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Runs `pnpm admin <args>` from the repository root against the same DATABASE_URL as the dev
 * server, and returns its trimmed output. Throws with the tool's error output on a non-zero exit.
 *
 * Tests make their own platform admin with it (`runAdmin("grant-platform-admin", "--email",
 * address)`) instead of logging in as a seeded person: all workspaces share one Mailpit inbox.
 */
export function runAdmin(...args: string[]): string {
  try {
    return execFileSync("pnpm", ["--silent", "admin", ...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`pnpm admin ${args.join(" ")} failed${stderr ? `:\n${stderr}` : ""}`, {
      cause: error,
    });
  }
}
