import type { ApiEnv } from "./env";

/** A complete, valid environment for tests. */
export const testEnv: ApiEnv = {
  DATABASE_URL: "postgres://unused",
  API_PORT: 4100,
  API_HOST: "::",
  ALLOWED_ORIGINS: ["http://localhost:4101", "http://localhost:4102"],
  GIT_COMMIT: "test-commit",
  MIN_APP_VERSION: "2027.0.0",
  LOG_LEVEL: "info",
};
