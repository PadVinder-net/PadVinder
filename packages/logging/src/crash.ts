import type { Logger } from "./logger";

const BEFORE_EXIT_LIMIT_MS = 2_000;

/**
 * Logs an uncaught exception or unhandled rejection at `error`, runs `beforeExit` (at most 2
 * seconds) and exits with code 1. Nothing it calls can make it exit otherwise: a throwing
 * logger or `beforeExit` is ignored, and the time limit holds the process open on its own.
 */
export function installCrashHandlers(
  logger: Logger,
  options: { beforeExit?: () => Promise<void> } = {},
): void {
  let exiting = false;
  const crash = (err: unknown, message: string) => {
    if (exiting) process.exit(1);
    exiting = true;
    process.exitCode = 1;
    try {
      logger.error({ err }, message);
    } catch {
      // A failing logger must not turn the crash into exit code 7 with a raw stack.
    }
    void Promise.race([
      Promise.resolve()
        .then(() => options.beforeExit?.())
        .catch(() => {}),
      // Ref'd on purpose: it keeps the process alive until the limit when nothing else does.
      new Promise<void>((resolve) => setTimeout(resolve, BEFORE_EXIT_LIMIT_MS)),
    ]).then(() => process.exit(1));
  };
  process.on("uncaughtException", (err) => crash(err, "Uncaught exception, exiting"));
  process.on("unhandledRejection", (reason) => crash(reason, "Unhandled rejection, exiting"));
}
