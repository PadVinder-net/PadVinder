import * as Sentry from "@sentry/react";
import { scrubBrowserBreadcrumb, scrubBrowserEvent } from "./scrub-event";

/** The hooks and functions of `react-router` that Sentry's navigation tracing needs. */
export type RouterTracingHooks = Pick<
  Parameters<typeof Sentry.reactRouterBrowserTracingIntegration>[0],
  "useLocation" | "useNavigationType" | "createRoutesFromChildren" | "matchRoutes"
>;

export type BrowserMonitoringOptions = {
  /** The `service` tag: the mobile app or the portal. */
  app: "app" | "portal";
  /** The `app_version` tag. */
  appVersion: string;
  /** The build's commit. The tunnel sets the server's own release; sessions need one here. */
  release: string;
  /** React Router's hooks, for spans named after routes. Without them, plain page load spans. */
  router?: RouterTracingHooks;
  /** Default: on in a production build only, so never under the Vite dev servers. */
  enabled?: boolean;
  /** For tests: instead of the fetch transport. */
  transport?: Sentry.BrowserOptions["transport"];
};

// The tunnel ignores the DSN and sends to the server's own; the SDK only needs a valid one.
export const PLACEHOLDER_DSN = "https://public@padvinder.invalid/1";
export const TUNNEL_PATH = "/api/sentry-tunnel";
// One phone in an error loop costs this many events per page load, not hundreds.
const MAX_ERRORS_PER_PAGE_LOAD = 10;

let enabled = false;
let errorsThisPageLoad = 0;

/**
 * Starts Sentry in the browser and answers whether it is on: only in a production build (or with
 * `enabled`), always through the tunnel, with every kind of data collection off. Call it once,
 * before the first render.
 */
export function startBrowserMonitoring(options: BrowserMonitoringOptions): boolean {
  if (!(options.enabled ?? import.meta.env.PROD)) return false;
  errorsThisPageLoad = 0;
  const tracing = options.router
    ? Sentry.reactRouterBrowserTracingIntegration(options.router)
    : Sentry.browserTracingIntegration();
  Sentry.init({
    dsn: PLACEHOLDER_DSN,
    tunnel: TUNNEL_PATH,
    enabled: true,
    ...(options.transport ? { transport: options.transport } : {}),
    release: options.release,
    initialScope: { tags: { service: options.app, app_version: options.appVersion } },
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    // Transactions with their spans, which the tunnel accepts and `beforeSendTransaction`
    // scrubs. The default since 11 ("stream") sends spans one by one.
    traceLifecycle: "static",
    tracesSampleRate: 1,
    // Trace headers only to our own API, so a tap and the request it causes are one trace.
    tracePropagationTargets: [/^\/api\//],
    integrations: [tracing],
    // A call that failed because there was no connection; the API reports its own 5xx.
    ignoreErrors: [
      "Failed to fetch",
      "Load failed",
      "NetworkError when attempting to fetch resource",
    ],
    beforeSend: (event) => {
      errorsThisPageLoad += 1;
      if (errorsThisPageLoad > MAX_ERRORS_PER_PAGE_LOAD) return null;
      return scrubBrowserEvent(event);
    },
    beforeSendTransaction: scrubBrowserEvent,
    beforeBreadcrumb: scrubBrowserBreadcrumb,
  });
  enabled = true;
  return true;
}

/** Sets the account's ID as the only user field, or clears it (`null`, after logging out). */
export function setBrowserMonitoringUser(id: string | null): void {
  if (!enabled) return;
  Sentry.setUser(id === null ? null : { id });
}

/** The ID of the last error event, for a problem report about a crash. */
export function lastErrorEventId(): string | undefined {
  return enabled ? Sentry.lastEventId() : undefined;
}

/** Stops Sentry and forgets this page load's user and breadcrumbs. For tests. */
export async function stopBrowserMonitoring(): Promise<void> {
  if (!enabled) return;
  enabled = false;
  await Sentry.close(2000);
  // The user lives on the isolation scope (`Sentry.setUser`); a cleared user on the current scope
  // would hide it from later events.
  Sentry.getIsolationScope().setUser(null).clearBreadcrumbs();
  Sentry.getCurrentScope().clearBreadcrumbs();
}
