import { createLogger, installCrashHandlers } from "@padvinder/logging";
import { flushMonitoring, readMonitoringSettings, startServerMonitoring } from "./index";

startServerMonitoring({ service: "api", settings: readMonitoringSettings(process.env) });
const logger = createLogger({ service: "api", level: "info" });
installCrashHandlers(logger, { beforeExit: () => flushMonitoring() });

setTimeout(() => {
  throw new Error("crash for a@b.test");
}, 10);
