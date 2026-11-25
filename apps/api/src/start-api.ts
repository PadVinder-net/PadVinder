import { createDb, liveEventsChannel } from "@padvinder/db";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "./app";
import type { ApiEnv } from "./env";
import { createSmtpMailer } from "@padvinder/mail";
import { startMailQueue } from "./mail/mail-queue";
import { startNotificationHub, type NotificationHub } from "./realtime/notification-hub";

export type RunningApi = { app: FastifyInstance; stop(): Promise<void> };

/**
 * Opens the database pool, builds the app and starts listening. A database that is down does not
 * stop the start: the pool connects lazily, the notification hub keeps retrying and the mail
 * queue connects on its first use, so `/api/health` can report it. On any other startup failure
 * (such as a port in use) it logs, closes what it opened and rethrows; the caller exits 1 so the
 * service supervisor restarts us.
 */
export async function startApi(env: ApiEnv): Promise<RunningApi> {
  // The pool needs a logger before the app exists; the app needs the pool. Errors in that
  // short window go to stderr.
  let app: FastifyInstance | undefined;
  const { db, pool } = createDb(env.DATABASE_URL, {
    onError: (error) =>
      app ? app.log.error({ err: error }, "Database pool error") : console.error(error),
  });
  let notifications: NotificationHub | undefined;
  const mailer = createSmtpMailer(env);
  // Connects on the first queued mail, not here: see startMailQueue.
  const mailQueue = startMailQueue(env, {
    onError: (error) =>
      app ? app.log.error({ err: error }, "Mail queue error") : console.error(error),
  });

  const stop = async () => {
    await app?.close();
    await notifications?.close();
    await mailQueue.stop();
    // A login code mail still in flight (sent without waiting) can be lost; no retries by design.
    mailer.close();
    await pool.end();
  };

  try {
    notifications = await startNotificationHub({
      databaseUrl: env.DATABASE_URL,
      channels: [liveEventsChannel],
      // The hub starts before the app exists. An unused Fastify instance gives the same JSON logger.
      logger: Fastify({ logger: { level: env.LOG_LEVEL } }).log,
    });
    app = await buildApp({
      env,
      db,
      notifications,
      mailer,
      queueMail: mailQueue.queueMail,
      logger: true,
    });
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
  } catch (error) {
    if (app) app.log.error({ err: error }, "API failed to start");
    else console.error("API failed to start", error);
    await stop().catch((stopError) =>
      console.error("Cleanup after failed start failed", stopError),
    );
    throw error;
  }
  return { app, stop };
}
