import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import mkcert from "vite-plugin-mkcert";
import { VitePWA } from "vite-plugin-pwa";
// A relative path with extension on purpose: Vite bundles relative imports into the config, but
// hands package imports to Node, which cannot load the TypeScript source of `@padvinder/contracts`.
import { calVerSchema } from "../../packages/contracts/src/version.ts";

import { manifest } from "./pwa-manifest.ts";

const DEFAULT_APP_VERSION = "2027.0.0";

// The root directory, resolved from this file so it works from any working directory.
const rootDir = `${import.meta.dirname}/../..`;

export default defineConfig(({ mode }) => {
  // The root .env and .env.local, with real environment variables taking precedence.
  const env = loadEnv(mode, rootDir, "");
  const port = Number(env.MOBILE_PORT);
  if (!env.MOBILE_PORT || !Number.isInteger(port)) {
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
  const https = env.DEV_HTTPS === "1";

  return {
    // The API serves the build at /app/, and the installed PWA's scope is /app/. Do not change.
    base: "/app/",
    envDir: rootDir,
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
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
        },
        devOptions: { enabled: false },
      }),
    ],
  };
});
