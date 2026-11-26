import type { BaseTransportOptions, Transport } from "@sentry/core";
import * as Sentry from "@sentry/node";
import { scrubBreadcrumb, scrubEvent } from "./scrub-event";
import type { MonitoringSettings } from "./settings";

export type TransportFactory = (options: BaseTransportOptions) => Transport;

// A test transport needs a DSN to be used at all; nothing is ever sent to this address.
const TEST_DSN = "https://public@sentry.invalid/1";
const SHUTDOWN_LIMIT_MS = 2_000;
// Left out: our crash handler logs the crash, and pino's error line is what Sentry captures.
// Fastify's own capture is replaced below, so an error the API logs is one event, not two.
const REPLACED_INTEGRATIONS = new Set(["OnUncaughtException", "OnUnhandledRejection", "Fastify"]);
const UNSAMPLED_PATHS = new Set(["/api/health", "/api/events"]);
const UNSAMPLED_JOBS = new Set(["heartbeat"]);

let enabled = false;

function attribute(attributes: Record<string, unknown> | undefined, key: string) {
  const value = attributes?.[key];
  return typeof value === "string" ? value : undefined;
}

/** The request path of a span about to be sampled, without its query, if it is a request. */
function requestPath(context: { name: string; attributes?: Record<string, unknown> }) {
  const target =
    attribute(context.attributes, "url.path") ??
    attribute(context.attributes, "http.target") ??
    /^[A-Z]+ (\/\S*)$/.exec(context.name)?.[1];
  return target?.split(/[?#]/)[0];
}

/**
 * Samples every trace except requests for `/api/health`, `/api/events` and every path outside
 * `/api/`, and the worker's `heartbeat` job.
 */
export function tracesSampler(context: {
  name: string;
  attributes?: Record<string, unknown>;
}): number {
  const job = attribute(context.attributes, "job.name");
  if (job !== undefined) return UNSAMPLED_JOBS.has(job) ? 0 : 1;
  const path = requestPath(context);
  if (path === undefined) return 1;
  return path.startsWith("/api/") && !UNSAMPLED_PATHS.has(path) ? 1 : 0;
}

/**
 * Starts Sentry when a DSN is set (or a test transport is given) and answers whether it is on.
 * Call it before anything loads `pg`, `fastify` or `http`, so they are instrumented.
 */
export function startServerMonitoring(options: {
  service: "api" | "worker";
  settings: MonitoringSettings;
  transport?: TransportFactory;
}): boolean {
  const { service, settings, transport } = options;
  const dsn = settings.dsn ?? (transport ? TEST_DSN : undefined);
  if (dsn === undefined) return false;
  Sentry.init({
    dsn,
    ...(transport ? { transport } : {}),
    environment: settings.environment,
    release: settings.release,
    serverName: service,
    initialScope: { tags: { service } },
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
    // Transactions with their spans, so `beforeSendTransaction` scrubs them. The default since
    // 11 ("stream") sends spans one by one and skips `beforeSendTransaction`.
    traceLifecycle: "static",
    tracesSampler,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    // Load-bearing: the SDK skips beforeSend for its own internal-exception events, which still
    // carry the scope's breadcrumbs.
    beforeBreadcrumb: scrubBreadcrumb,
    integrations: (defaults) => [
      ...defaults.filter((integration) => !REPLACED_INTEGRATIONS.has(integration.name)),
      Sentry.fastifyIntegration({ shouldHandleError: () => false }),
      Sentry.pinoIntegration({ error: { levels: ["error"] }, log: { levels: [] } }),
    ],
  });
  enabled = true;
  return true;
}

/** Sets the account's ID as the only user field on the current isolation scope, or clears it. */
export function setMonitoringUser(id: string | null): void {
  if (!enabled) return;
  Sentry.getIsolationScope().setUser(id === null ? null : { id });
}

export function withSpan<T>(
  name: string,
  op: string,
  attributes: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!enabled) return fn();
  return Sentry.startSpan({ name, op, attributes }, fn);
}

/** Runs a job in a trace of its own, with its name and ID as span attributes and scope tags. */
export function runJobInSpan<T>(
  job: { name: string; id: string },
  fn: () => Promise<T>,
): Promise<T> {
  if (!enabled) return fn();
  const tags = { "job.name": job.name, "job.id": job.id };
  return Sentry.withIsolationScope(() =>
    Sentry.startNewTrace(() =>
      Sentry.startSpan({ name: job.name, op: "queue.process", attributes: tags }, () => {
        Sentry.getCurrentScope().setTags(tags);
        return fn();
      }),
    ),
  );
}

/** Sends what is queued, waiting at most `timeoutMs`. Never rejects. */
export async function flushMonitoring(timeoutMs = SHUTDOWN_LIMIT_MS): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Sentry never fails a shutdown.
  }
}

/** Sends what is queued and stops Sentry, waiting at most `timeoutMs`. Never rejects. */
export async function closeMonitoring(timeoutMs = SHUTDOWN_LIMIT_MS): Promise<void> {
  if (!enabled) return;
  enabled = false;
  try {
    await Sentry.close(timeoutMs);
  } catch {
    // Sentry never fails a shutdown.
  }
}
