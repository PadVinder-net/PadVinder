import { loadApiEnv, type ApiEnv } from "./env";
import { createLogger, installCrashHandlers } from "@padvinder/logging";
import {
  closeMonitoring,
  flushMonitoring,
  onSentrySendFailure,
  type MonitoringSettings,
} from "@padvinder/monitoring";
import { startApi } from "./start-api";

/** The API process: loaded by main.ts after Sentry has started, with the settings it read. */
export async function run(monitoring: MonitoringSettings): Promise<void> {
  let env: ApiEnv;
  try {
    env = loadApiEnv(process.env);
  } catch (error) {
    // A configuration mistake: the message names every problem, a stack trace adds nothing.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const logger = createLogger({ service: "api", level: env.LOG_LEVEL });
  // The crash's log line is what Sentry captures; send it before the process exits.
  installCrashHandlers(logger, { beforeExit: () => flushMonitoring() });
  // The SDK says nothing when Sentry refuses an event; a warning (never an error, which Sentry
  // would capture again) says it here, with the status only.
  onSentrySendFailure((failure) =>
    logger.warn(
      { sentryStatus: failure.status, eventType: failure.eventType },
      "Sentry did not take an event",
    ),
  );

  // A terminal Ctrl-C reaches both tsx and the API, so a repeat within this window is not a force.
  const FORCE_EXIT_AFTER_MS = 1_000;
  let shutdownStartedAt: number | undefined;
  let api: Awaited<ReturnType<typeof startApi>> | undefined;

  async function shutdown(signal: string): Promise<void> {
    if (shutdownStartedAt !== undefined) {
      if (Date.now() - shutdownStartedAt >= FORCE_EXIT_AFTER_MS) {
        logger.warn(`Received ${signal} again, exiting now`);
        process.exit(1);
      }
      return;
    }
    shutdownStartedAt = Date.now();
    logger.info(`Received ${signal}, shutting down`);
    try {
      await api?.stop();
      // Also when the API never started; a no-op after stop() closed it.
      await closeMonitoring();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "Shutdown failed");
      await closeMonitoring();
      process.exit(1);
    }
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  // Alwaysdata restarts a service by sending SIGTERM and starting it again once it has exited. SIGHUP is handled the same way.
  process.on("SIGHUP", () => void shutdown("SIGHUP"));

  try {
    api = await startApi(env, logger, monitoring);
  } catch {
    // startApi has logged and cleaned up. Close again (a no-op when it did), so the "failed to
    // start" event is sent even when the cleanup threw. Exit deliberately so the supervisor
    // restarts us.
    await closeMonitoring();
    process.exit(1);
  }
}
