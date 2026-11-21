import { createDb } from "@padvinder/db";
import { expect, test } from "vitest";
import { buildApp } from "./app";
import { createNoopNotificationHub } from "./realtime/notification-hub";
import { testEnv } from "./test-env";

test("documents getHealth and getVersion with named components", async () => {
  const { db, pool } = createDb("postgres://padvinder:padvinder@127.0.0.1:1/none");
  const app = await buildApp({ env: testEnv, db, notifications: createNoopNotificationHub() });
  await app.ready();
  const doc = app.swagger();
  expect(doc.info.title).toBe("PadVinder API");
  expect(doc.paths?.["/api/health"]?.get?.operationId).toBe("getHealth");
  expect(doc.paths?.["/api/version"]?.get?.operationId).toBe("getVersion");
  // swagger() is typed as OpenAPI 2 or 3; we generate 3.
  const components = "components" in doc ? doc.components : undefined;
  expect(Object.keys(components?.schemas ?? {})).toEqual(
    expect.arrayContaining(["HealthResponse", "VersionResponse"]),
  );
  await app.close();
  await pool.end();
});
