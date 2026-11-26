import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import mkcert from "vite-plugin-mkcert";

// The root directory, resolved from this file so it works from any working directory.
const rootDir = `${import.meta.dirname}/../..`;

export default defineConfig(({ command, mode }) => {
  // The root .env and .env.local, with real environment variables taking precedence.
  const env = loadEnv(mode, rootDir, "");
  const port = Number(env.PORTAL_PORT);
  // Only the dev server needs a port; CI and the release build have none.
  if (command === "serve" && (!env.PORTAL_PORT || !Number.isInteger(port))) {
    throw new Error(
      "PORTAL_PORT is missing or not a number. Run scripts/setup-workspace.sh to create .env.",
    );
  }
  const https = env.DEV_HTTPS === "1";
  // The commit, Sentry's release: scripts/build-release.sh sets GIT_COMMIT. Empty counts as unset.
  const gitCommit = env.GIT_COMMIT || "dev";

  return {
    base: "/",
    envDir: rootDir,
    define: {
      __GIT_COMMIT__: JSON.stringify(gitCommit),
      // The app's dev port, so a requests link can go on to it; null in a build (one origin).
      __APP_DEV_PORT__: JSON.stringify(
        command === "serve" && env.MOBILE_PORT ? Number(env.MOBILE_PORT) : null,
      ),
    },
    // Maps for Sentry, without a `sourceMappingURL` in the bundles: scripts/build-release.sh moves
    // them out of the served directory.
    build: { sourcemap: "hidden" },
    server: {
      port,
      strictPort: true,
      // Over the local network, as in the mobile app.
      ...(https ? { host: true } : {}),
      // `/api/events` is a long-lived SSE stream; the proxy passes it through unbuffered.
      proxy: { "/api": { target: `http://localhost:${env.API_PORT}` } },
    },
    plugins: [react(), tailwindcss(), ...(https ? [mkcert()] : [])],
  };
});
