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
import { AuthGate } from "./auth/auth-gate";
import { RootCrashBoundary } from "./layout/crash";
import { isDevCrashOutsideRouter, routes } from "./router";
import { appUrlForThisBrowser } from "./send-to-app";
import "./index.css";

// A link meant for the other app goes there before anything renders, so before any login.
const forwardTo = appUrlForThisBrowser();
if (forwardTo) {
  window.location.replace(forwardTo);
} else {
  // Off under the Vite dev server; in a build it sends through /api/sentry-tunnel only. The portal
  // has no version of its own: it is identified by its commit.
  const monitoring = startBrowserMonitoring({
    app: "portal",
    appVersion: __GIT_COMMIT__,
    release: __GIT_COMMIT__,
    router: { useLocation, useNavigationType, createRoutesFromChildren, matchRoutes },
  });
  reloadOnPreloadError();
  const queryClient = createQueryClient();
  const createRouter = monitoring
    ? Sentry.wrapCreateBrowserRouter(createBrowserRouter)
    : createBrowserRouter;
  const router = createRouter(routes);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/* A crash in a page is the router's; this one catches the rest, such as the login. */}
        <RootCrashBoundary>
          {isDevCrashOutsideRouter(window.location.pathname) ? (
            <DevCrashOutsideRouter />
          ) : (
            <AuthGate onLoggedOut={() => void router.navigate("/", { replace: true })}>
              <RouterProvider router={router} />
            </AuthGate>
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
