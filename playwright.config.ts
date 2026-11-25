import { defineConfig, devices } from "@playwright/test";
import { loadRootEnv } from "./scripts/load-env.ts";

// Real environment variables win over .env.local, which wins over .env.
loadRootEnv();

const mobilePort = process.env.MOBILE_PORT;
if (!mobilePort) throw new Error("MOBILE_PORT is not set. Run scripts/setup-workspace.sh.");
const portalPort = process.env.PORTAL_PORT;
if (!portalPort) throw new Error("PORTAL_PORT is not set. Run scripts/setup-workspace.sh.");

/** The portal's tests: `portal-*.spec.ts`, in a laptop-sized browser on the portal's origin. */
const portalSpecs = "**/portal-*.spec.ts";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  // In CI: annotations on the pull request, plus an HTML report and traces of failed tests,
  // which the e2e job uploads as an artifact.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: process.env.CI ? { trace: "retain-on-failure" } : {},
  projects: [
    {
      name: "chromium",
      testIgnore: portalSpecs,
      use: { ...devices["Pixel 7"], baseURL: `http://localhost:${mobilePort}` },
    },
    {
      name: "portal",
      testMatch: portalSpecs,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://localhost:${portalPort}`,
      },
    },
  ],
  webServer: [
    {
      command: "pnpm dev",
      // The API through the mobile dev server's proxy: ready only when both listen (the proxy
      // answers 502 while the API is down). Tests post to /api at once, so /app/ alone is too
      // early.
      url: `http://localhost:${mobilePort}/api/version`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // `pnpm dev` above starts the portal too; this only waits until its dev server answers.
      // Playwright starts the servers one after the other, so the portal is usually up by now.
      command: 'node -e "setInterval(() => {}, 1000)"',
      url: `http://localhost:${portalPort}/api/version`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
