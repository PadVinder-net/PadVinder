import { createLogger } from "./logger";
import { installCrashHandlers } from "./crash";

const logger = createLogger({ service: "api", level: "info" });
installCrashHandlers(logger, {
  beforeExit: async () => {
    process.stderr.write("before-exit\n");
  },
});

if (process.argv[2] === "reject") {
  void Promise.reject({ reason: "c@d.test" });
} else {
  setTimeout(() => {
    throw new Error("crash for a@b.test");
  }, 10);
}
