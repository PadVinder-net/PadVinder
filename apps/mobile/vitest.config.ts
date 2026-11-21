import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify("2027.0.0") },
  test: {
    name: "mobile",
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
