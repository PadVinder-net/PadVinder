import { createLogger, installCrashHandlers } from "@padvinder/logging";
import { closeMonitoring, flushMonitoring } from "@padvinder/monitoring";
import { loadWorkerEnv, type WorkerEnv } from "./env";
import { startWorker } from "./start-worker";

/** The worker process: loaded by main.ts after Sentry has started. */
export async function run(): Promise<void> {
  let env: WorkerEnv;
  try {
    env = loadWorkerEnv(process.env);
  } catch (error) {
    // A configuration mistake: the message names every problem, a stack trace adds nothing.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const logger = createLogger({ service: "worker", level: env.LOG_LEVEL });
  // The crash's log line is what Sentry captures; send it before the process exits.
  installCrashHandlers(logger, { beforeExit: () => flushMonitoring() });

  // A terminal Ctrl-C reaches both tsx and the worker, so a repeat within this window is not a force.
  const FORCE_EXIT_AFTER_MS = 1_000;
  let shutdownStartedAt: number | undefined;
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;

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
      await worker?.stop();
      // Also when the worker never started; a no-op once closed.
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
    worker = await startWorker(env, logger);
    logger.info(
      { commit: env.GIT_COMMIT, environment: env.PADVINDER_ENVIRONMENT },
      "Worker started",
    );
  } catch {
    // startWorker has logged and cleaned up. Send its error line to Sentry, then exit
    // deliberately so the supervisor restarts us. (The API's stop() closes monitoring itself.)
    await closeMonitoring();
    process.exit(1);
  }
}
