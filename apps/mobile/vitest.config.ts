import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify("2027.0.0"),
    __APP_BUILD__: JSON.stringify("dev"),
    __GIT_COMMIT__: JSON.stringify("dev"),
    __PORTAL_DEV_PORT__: "null",
  },
  test: {
    name: "mobile",
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
