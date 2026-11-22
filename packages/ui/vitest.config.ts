import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ui",
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Visual tests run in a real browser, in the Playwright image: vitest.visual.config.ts.
    exclude: [...configDefaults.exclude, "**/*.visual.test.tsx"],
  },
});
