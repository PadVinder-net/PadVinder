import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Visual tests of every Storybook story. Not a project of the root Vitest config, so
// `pnpm test` never runs them: they only pass in the Playwright Docker image, whose fonts
// and rendering the reference screenshots were made with (`pnpm test:visual:docker`).
export default defineConfig({
  root: import.meta.dirname,
  // The same plugins Storybook uses: its React framework and Tailwind (.storybook/main.ts).
  plugins: [react(), tailwindcss()],
  test: {
    name: "ui-visual",
    include: ["src/**/*.visual.test.tsx"],
    setupFiles: [".storybook/visual-setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      // A phone: the mobile app is phone only.
      viewport: { width: 390, height: 844 },
    },
  },
});
