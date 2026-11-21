import { defineConfig, devices } from "@playwright/test";
import { loadRootEnv } from "./scripts/load-env.ts";

// Real environment variables win over .env.local, which wins over .env.
loadRootEnv();

const mobilePort = process.env.MOBILE_PORT;
if (!mobilePort) throw new Error("MOBILE_PORT is not set. Run scripts/setup-workspace.sh.");

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${mobilePort}` },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${mobilePort}/app/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
