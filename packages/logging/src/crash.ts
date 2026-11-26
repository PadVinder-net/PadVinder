import type { Logger } from "./logger";

const BEFORE_EXIT_LIMIT_MS = 2_000;

export function installCrashHandlers(
  logger: Logger,
  options: { beforeExit?: () => Promise<void> } = {},
): void {
  let exiting = false;
  const crash = (err: unknown, message: string) => {
    if (exiting) process.exit(1);
    exiting = true;
    logger.error({ err }, message);
    const cleanup = options.beforeExit
      ? Promise.race([
          options.beforeExit().catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, BEFORE_EXIT_LIMIT_MS).unref()),
        ])
      : Promise.resolve();
    void cleanup.then(() => process.exit(1));
  };
  process.on("uncaughtException", (err) => crash(err, "Uncaught exception, exiting"));
  process.on("unhandledRejection", (reason) => crash(reason, "Unhandled rejection, exiting"));
}
