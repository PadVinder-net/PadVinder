// Sentry starts before anything loads `pg`, `fastify` or `http`, so they are instrumented: this
// file imports only the monitoring package, and loads the API itself afterwards. The bundle
// hoists every static import of an external package to the top, so no other import goes here.
import {
  readMonitoringSettings,
  startServerMonitoring,
  type MonitoringSettings,
} from "@padvinder/monitoring";

let settings: MonitoringSettings;
try {
  settings = readMonitoringSettings(process.env);
} catch (error) {
  // A configuration mistake: the message names the variable, a stack trace adds nothing.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
startServerMonitoring({ service: "api", settings });

const { run } = await import("./run");
await run();
