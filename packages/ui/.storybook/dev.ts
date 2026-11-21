import { spawnSync } from "node:child_process";

// Started with Node's --env-file flags for the root .env files, as the other apps do.
const port = process.env.STORYBOOK_PORT ?? "6006";
const result = spawnSync("storybook", ["dev", "--no-open", "--port", port], { stdio: "inherit" });
process.exit(result.status ?? 1);
