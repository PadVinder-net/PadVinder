import { defineConfig } from "vitest/config";
import { loadRootEnv } from "../../scripts/load-env.ts";

// Integration tests against a fake SSH host in Docker: `pnpm test:fake-host`. Not part of
// `pnpm test`. DATABASE_URL comes from the real environment, .env.local or .env.
loadRootEnv();

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: "infra-alwaysdata",
    include: ["src/**/*.fake-host.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
