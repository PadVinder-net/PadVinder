import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import mkcert from "vite-plugin-mkcert";
import { VitePWA } from "vite-plugin-pwa";
// A relative path with extension on purpose: Vite bundles relative imports into the config, but
// hands package imports to Node, which cannot load the TypeScript source of `@padvinder/contracts`.
import { calVerSchema } from "../../packages/contracts/src/version.ts";

import { manifest } from "./pwa-manifest.ts";

// The single source of the app version: bump it in package.json. PADVINDER_APP_VERSION overrides it.
const DEFAULT_APP_VERSION: string = JSON.parse(
  readFileSync(`${import.meta.dirname}/package.json`, "utf8"),
).version;

// The root directory, resolved from this file so it works from any working directory.
const rootDir = `${import.meta.dirname}/../..`;

export default defineConfig(({ command, mode }) => {
  // The root .env and .env.local, with real environment variables taking precedence.
  const env = loadEnv(mode, rootDir, "");
  const port = Number(env.MOBILE_PORT);
  // Only the dev server needs a port; CI and the release build have none.
  if (command === "serve" && (!env.MOBILE_PORT || !Number.isInteger(port))) {
    throw new Error(
      "MOBILE_PORT is missing or not a number. Run scripts/setup-workspace.sh to create .env.",
    );
  }
  // An invalid version makes the version gate fail open, so both build and dev refuse it.
  // Empty counts as unset. Not named APP_VERSION: Conductor sets that one in its shells.
  const appVersion = env.PADVINDER_APP_VERSION || DEFAULT_APP_VERSION;
  if (!calVerSchema.safeParse(appVersion).success) {
    throw new Error(
      `PADVINDER_APP_VERSION "${appVersion}" is not a CalVer version like 2027.1.0 (YYYY.N.P). ` +
        `Set it to YYYY.N.P or leave it unset to use ${DEFAULT_APP_VERSION}.`,
    );
  }
  // The CI run number, shown next to the version. Empty counts as unset.
  const appBuild = env.PADVINDER_BUILD_NUMBER || "dev";
  // The commit, Sentry's release: scripts/build-release.sh sets GIT_COMMIT. Empty counts as unset.
  const gitCommit = env.GIT_COMMIT || "dev";
  const https = env.DEV_HTTPS === "1";

  return {
    // The API serves the build at /app/, and the installed PWA's scope is /app/. Do not change.
    base: "/app/",
    envDir: rootDir,
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_BUILD__: JSON.stringify(appBuild),
      __GIT_COMMIT__: JSON.stringify(gitCommit),
      // The portal's dev port, so a request link can go on to it; null in a build (one origin).
      __PORTAL_DEV_PORT__: JSON.stringify(
        command === "serve" && env.PORTAL_PORT ? Number(env.PORTAL_PORT) : null,
      ),
    },
    // Maps for Sentry, without a `sourceMappingURL` in the bundles: scripts/build-release.sh moves
    // them out of the served directory.
    build: { sourcemap: "hidden" },
    server: {
      port,
      strictPort: true,
      // Over the local network, so a phone can reach the dev server with HTTPS.
      ...(https ? { host: true } : {}),
      // `/api/events` is a long-lived SSE stream; the proxy passes it through unbuffered.
      proxy: { "/api": { target: `http://localhost:${env.API_PORT}` } },
    },
    plugins: [
      react(),
      tailwindcss(),
      ...(https ? [mkcert()] : []),
      VitePWA({
        registerType: "prompt",
        // The icons are generated from public/icon.svg during the build (see pwa-assets.config.ts).
        pwaAssets: { config: true },
        manifest,
        workbox: {
          navigateFallback: "/app/index.html",
          navigateFallbackDenylist: [/^\/api\//],
          // No runtimeCaching: API responses are never cached by the service worker.
          // No maps for the service worker: Sentry does not run in it.
          sourcemap: false,
        },
        devOptions: { enabled: false },
      }),
    ],
  };
});
