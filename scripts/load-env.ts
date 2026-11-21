import { existsSync } from "node:fs";

/**
 * Loads the root .env.local, then .env. loadEnvFile never overrides a variable that is
 * already set, so real environment variables (CI) win, then .env.local, then .env.
 */
export function loadRootEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const path = `${import.meta.dirname}/../${file}`;
    if (existsSync(path)) process.loadEnvFile(path);
  }
}
