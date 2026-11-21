import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "portal",
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
