import { defineConfig } from "vitest/config";

// TEST_DATABASE_URL is loaded by the root vitest.config.ts.
export default defineConfig({
  test: {
    name: "api",
  },
});
