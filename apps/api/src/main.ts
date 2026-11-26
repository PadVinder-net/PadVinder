import { loadApiEnv, type ApiEnv } from "./env";
import { createLogger, installCrashHandlers } from "@padvinder/logging";
import { startApi } from "./start-api";

let env: ApiEnv;
try {
  env = loadApiEnv(process.env);
} catch (error) {
  // A configuration mistake: the message names every problem, a stack trace adds nothing.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = createLogger({ service: "api", level: env.LOG_LEVEL });
installCrashHandlers(logger);

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
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Shutdown failed");
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
// Alwaysdata restarts a service by sending SIGTERM and starting it again once it has exited. SIGHUP is handled the same way.
process.on("SIGHUP", () => void shutdown("SIGHUP"));

try {
  api = await startApi(env, logger);
} catch {
  // startApi has logged and cleaned up. Exit deliberately so the supervisor restarts us.
  process.exit(1);
}
