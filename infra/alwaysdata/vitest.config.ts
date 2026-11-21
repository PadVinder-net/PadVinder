import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "infra-alwaysdata",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.fake-host.test.ts"],
  },
});
