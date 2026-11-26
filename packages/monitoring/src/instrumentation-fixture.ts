import { flushMonitoring, readMonitoringSettings, startServerMonitoring, withSpan } from "./index";

// Sentry first, so `pg` is instrumented when it loads.
startServerMonitoring({ service: "api", settings: readMonitoringSettings(process.env) });
const { default: pg } = await import("pg");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await withSpan("fixture", "test", {}, async () => {
  await client.query("select $1::text as v", ["noor@example.test"]);
});
await client.end();
await flushMonitoring();
