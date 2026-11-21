import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api-client",
    // Hook tests need a DOM; the pure tests do not mind it.
    environment: "jsdom",
  },
});
