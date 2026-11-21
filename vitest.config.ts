import { defineConfig } from "vitest/config";
import { loadRootEnv } from "./scripts/load-env.ts";

// Project configs and workers inherit these variables from this process.
loadRootEnv();

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/*",
      "infra/*",
      { test: { name: "scripts", include: ["scripts/**/*.test.ts"] } },
    ],
    // Root-level, so it runs once per run, not once per project.
    globalSetup: ["./scripts/vitest-global-setup.ts"],
  },
});
