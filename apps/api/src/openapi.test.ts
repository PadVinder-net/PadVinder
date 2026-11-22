import { createDb } from "@padvinder/db";
import { expect, test } from "vitest";
import { buildApp } from "./app";
import { createMemoryMailer } from "./mail/mailer";
import { createNoopNotificationHub } from "./realtime/notification-hub";
import { testEnv } from "./test-env";

test("documents getHealth and getVersion with named components", async () => {
  const { db, pool } = createDb("postgres://padvinder:padvinder@127.0.0.1:1/none");
  const app = await buildApp({
    env: testEnv,
    db,
    notifications: createNoopNotificationHub(),
    mailer: createMemoryMailer(),
  });
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

test("documents getMe and updateMe with their error responses as ApiError", async () => {
  const { db, pool } = createDb("postgres://padvinder:padvinder@127.0.0.1:1/none");
  const app = await buildApp({
    env: testEnv,
    db,
    notifications: createNoopNotificationHub(),
    mailer: createMemoryMailer(),
  });
  await app.ready();
  const doc = app.swagger();
  const me = doc.paths?.["/api/me"];
  expect(me?.get?.operationId).toBe("getMe");
  expect(me?.patch?.operationId).toBe("updateMe");
  const ref = (operation: unknown, status: string) =>
    JSON.stringify((operation as { responses: Record<string, unknown> }).responses[status]);
  expect(ref(me?.get, "401")).toContain("#/components/schemas/ApiError");
  expect(ref(me?.patch, "400")).toContain("#/components/schemas/ApiError");
  expect(ref(me?.patch, "401")).toContain("#/components/schemas/ApiError");
  const components = "components" in doc ? doc.components : undefined;
  expect(Object.keys(components?.schemas ?? {})).toEqual(
    expect.arrayContaining(["MeResponse", "UpdateMeRequest", "ApiError"]),
  );
  await app.close();
  await pool.end();
});
