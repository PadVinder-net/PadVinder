import { createLogger } from "./logger";
import { installCrashHandlers } from "./crash";

// Modes: `throw` and `reject` crash normally; `hang` has a beforeExit that never settles;
// `before-exit-throws` has a beforeExit that throws synchronously; `logger-throws` has a logger
// whose `error` throws.
const mode = process.argv[2] ?? "throw";
const logger = createLogger({ service: "api", level: "info" });
if (mode === "logger-throws") {
  logger.error = () => {
    throw new Error("log failed for e@f.test");
  };
}

installCrashHandlers(logger, {
  beforeExit: () => {
    process.stderr.write("before-exit\n");
    if (mode === "hang") return new Promise<void>(() => {});
    if (mode === "before-exit-throws") throw new Error("cleanup failed for g@h.test");
    return Promise.resolve();
  },
});

if (mode === "reject") {
  void Promise.reject({ reason: "c@d.test" });
} else {
  setTimeout(() => {
    throw new Error("crash for a@b.test");
  }, 10);
}
