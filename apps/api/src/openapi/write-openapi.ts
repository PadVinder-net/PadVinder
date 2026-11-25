import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@padvinder/db";
import { buildApp } from "../app";
import type { ApiEnv } from "../env";
import { createMemoryMailer, createMemoryMailQueue } from "@padvinder/mail";
import { createNoopNotificationHub } from "../realtime/notification-hub";

// Written explicitly, never read from the environment: the file must not depend on who runs this.
const env: ApiEnv = {
  DATABASE_URL: "postgres://unused@127.0.0.1:1/unused",
  API_PORT: 1,
  API_HOST: "::",
  ALLOWED_ORIGINS: ["http://localhost"],
  // Becomes `info.version`; a fixed value keeps regeneration stable.
  GIT_COMMIT: "openapi",
  MIN_APP_VERSION: "2027.0.0",
  LOG_LEVEL: "error",
  AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
  PUBLIC_ORIGIN: "http://localhost",
  SMTP_HOST: "localhost",
  SMTP_PORT: 54325,
  MAIL_FROM: "PadVinder <noreply@padvinder.test>",
  LOGIN_RATE_LIMITS: "off",
};

const outputPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/api-client/openapi.json",
);

// The pool never connects: building the app and describing its routes runs no query.
const { db, pool } = createDb(env.DATABASE_URL);
const app = await buildApp({
  env,
  db,
  notifications: createNoopNotificationHub(),
  mailer: createMemoryMailer(),
  queueMail: createMemoryMailQueue().queueMail,
});
try {
  await app.ready();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(app.swagger(), null, 2)}\n`);
} finally {
  await app.close();
  await pool.end();
}
