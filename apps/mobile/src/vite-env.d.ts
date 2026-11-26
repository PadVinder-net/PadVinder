/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

/** Set in `vite.config.ts` and `vitest.config.ts`. */
declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
/** The commit of this build (`GIT_COMMIT`), `dev` without one: Sentry's release. */
declare const __GIT_COMMIT__: string;
declare const __PORTAL_DEV_PORT__: number | null;
