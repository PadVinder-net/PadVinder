import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __APP_DEV_PORT__: "null" },
  test: {
    name: "portal",
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
