import { loadWorkerEnv, type WorkerEnv } from "./env";
import { createLogger } from "./logger";
import { startWorker } from "./start-worker";

let env: WorkerEnv;
try {
  env = loadWorkerEnv(process.env);
} catch (error) {
  // A configuration mistake: the message names every problem, a stack trace adds nothing.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const logger = createLogger(env.LOG_LEVEL);

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
    process.exit(0);
  } catch (error) {
    logger.error("Shutdown failed", error);
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
// Alwaysdata restarts a service by sending SIGHUP and starting it again once it has exited.
process.on("SIGHUP", () => void shutdown("SIGHUP"));

try {
  worker = await startWorker(env, logger);
  logger.info("Worker started");
} catch {
  // startWorker has logged and cleaned up. Exit deliberately so the supervisor restarts us.
  process.exit(1);
}
