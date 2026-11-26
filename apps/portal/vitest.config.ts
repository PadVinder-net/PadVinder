import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __APP_DEV_PORT__: "null", __GIT_COMMIT__: JSON.stringify("dev") },
  test: {
    name: "portal",
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
