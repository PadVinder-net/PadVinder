// Checks that a commit is still the current release of main, for the production job of
// Deploy: prints a GitHub notice and exits 0 when it is, an error and exit 1 when it is not.
// Plain Node.js, no dependencies: the job that runs it installs none.
//
//   node scripts/deploy-current.ts <commit> <head>      for example "$GITHUB_SHA" origin/main
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkDeploy, deployPathsIgnore } from "./lib/deploy-current.ts";

const [commit, head, ...extra] = process.argv.slice(2);
if (!commit || !head || extra.length > 0) {
  console.error("Usage: node scripts/deploy-current.ts <commit> <head>");
  process.exit(2);
}

const root = join(import.meta.dirname, "..");
const workflow = await readFile(join(root, ".github/workflows/deploy.yml"), "utf8");
const { decision, message } = checkDeploy({
  cwd: root,
  commit,
  head,
  patterns: deployPathsIgnore(workflow),
});

console.log(`${decision.current ? "::notice::" : "::error::"}${message}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Production deploy check\n\n${message}\n`);
}
process.exit(decision.current ? 0 : 1);
