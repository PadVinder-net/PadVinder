import { createQueryClient } from "@padvinder/api-client";
import { reloadOnPreloadError, startBrowserMonitoring } from "@padvinder/ui";
import * as Sentry from "@sentry/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  createRoutesFromChildren,
  matchRoutes,
  RouterProvider,
  useLocation,
  useNavigationType,
} from "react-router";
import { APP_VERSION } from "./app-version";
import { AuthGate } from "./auth/auth-gate";
import { RootCrashBoundary } from "./components/crash";
import { VersionGate } from "./components/version-gate";
import { appBasename, isDevCrashOutsideRouter, routes } from "./router";
import { portalUrlForThisBrowser } from "./hooks/send-to-portal";
import "./index.css";

// A link meant for the other app goes there before anything renders, so before any login.
const forwardTo = portalUrlForThisBrowser();
if (forwardTo) {
  window.location.replace(forwardTo);
} else {
  // Off under the Vite dev server; in a build it sends through /api/sentry-tunnel only.
  const monitoring = startBrowserMonitoring({
    app: "app",
    appVersion: APP_VERSION,
    release: __GIT_COMMIT__,
    router: { useLocation, useNavigationType, createRoutesFromChildren, matchRoutes },
  });
  reloadOnPreloadError();
  const queryClient = createQueryClient();
  const createRouter = monitoring
    ? Sentry.wrapCreateBrowserRouter(createBrowserRouter)
    : createBrowserRouter;
  const router = createRouter(routes, { basename: appBasename });

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/* A crash in a screen is the router's; this one catches the rest, such as the login. */}
        <RootCrashBoundary>
          {isDevCrashOutsideRouter(window.location.pathname) ? (
            <DevCrashOutsideRouter />
          ) : (
            <VersionGate>
              <AuthGate>
                <RouterProvider router={router} />
              </AuthGate>
            </VersionGate>
          )}
        </RootCrashBoundary>
      </QueryClientProvider>
    </StrictMode>,
  );
}

/** Dev server only: a crash outside the router, as on the login screen, for the end-to-end test. */
function DevCrashOutsideRouter(): never {
  throw new Error("A crash on purpose, outside the router, for the end-to-end test");
}
