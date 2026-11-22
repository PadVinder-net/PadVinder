// Regenerates the generated files and fails when that changed anything.
// It compares file contents before and after, not git, so uncommitted work
// never causes a false alarm.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffSnapshots, snapshotFiles } from "./lib/file-snapshot.ts";

export const GENERATED_PATHS = [
  "packages/api-client/openapi.json",
  "packages/api-client/src/generated",
  "packages/db/drizzle",
] as const;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command: string) {
  console.log(`\n> ${command}`);
  const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`Command failed: ${command}`);
    process.exit(result.status ?? 1);
  }
}

const before = await snapshotFiles(root, GENERATED_PATHS);
run("pnpm api:generate");
run("pnpm db:generate");
const diff = diffSnapshots(before, await snapshotFiles(root, GENERATED_PATHS));

const lines = [
  ...diff.added.map((path) => `added    ${path}`),
  ...diff.changed.map((path) => `changed  ${path}`),
  ...diff.removed.map((path) => `removed  ${path}`),
];
if (lines.length > 0) {
  console.error(`\n${lines.join("\n")}`);
  console.error(
    "\nGenerated files were out of date. They are regenerated now: review and commit them.",
  );
  process.exit(1);
}
console.log("\nGenerated files are up to date.");
