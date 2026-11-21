import { defineConfig, devices } from "@playwright/test";
import { loadRootEnv } from "./scripts/load-env.ts";

// Real environment variables win over .env.local, which wins over .env.
loadRootEnv();

const mobilePort = process.env.MOBILE_PORT;
if (!mobilePort) throw new Error("MOBILE_PORT is not set. Run scripts/setup-workspace.sh.");

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  // In CI: annotations on the pull request, plus an HTML report and traces of failed tests,
  // which the e2e job uploads as an artifact.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${mobilePort}`,
    ...(process.env.CI ? { trace: "retain-on-failure" } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${mobilePort}/app/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
