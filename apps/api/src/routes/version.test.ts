import { expect, test } from "vitest";
import { buildApp } from "../app";
import { createDb } from "@padvinder/db";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";

test("reports the minimum app version and commit", async () => {
  // The version route never touches the database, so a never-connected pool is enough.
  const { db, pool } = createDb("postgres://padvinder:padvinder@127.0.0.1:1/none");
  const app = await buildApp({ env: testEnv, db, notifications: createNoopNotificationHub() });
  expect((await app.inject("/api/version")).json()).toEqual({
    minimumAppVersion: "2027.0.0",
    commit: "test-commit",
  });
  await app.close();
  await pool.end();
});
