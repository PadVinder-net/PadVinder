// Reads the changed paths of a pull request (one per line) from stdin and prints which CI
// jobs to run, as `job=true|false` lines for $GITHUB_OUTPUT. Plain Node.js, no dependencies:
// the CI job that runs it installs none.
//
//   git diff --name-only origin/main...HEAD | node scripts/ci-changes.ts
import { text } from "node:stream/consumers";
import { CI_JOBS, jobsFor } from "./lib/ci-jobs.ts";

const jobs = jobsFor((await text(process.stdin)).split("\n"));
for (const job of CI_JOBS) console.log(`${job}=${jobs[job]}`);
