import { createDb, liveEventsChannel } from "@padvinder/db";
import type { Logger } from "@padvinder/logging";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import type { ApiEnv } from "./env";
import { createSmtpMailer } from "@padvinder/mail";
import { closeMonitoring, type MonitoringSettings } from "@padvinder/monitoring";
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
export async function startApi(
  env: ApiEnv,
  logger: Logger,
  monitoring?: MonitoringSettings,
): Promise<RunningApi> {
  let app: FastifyInstance | undefined;
  const { db, pool } = createDb(env.DATABASE_URL, {
    onError: (error) => logger.error({ err: error }, "Database pool error"),
  });
  let notifications: NotificationHub | undefined;
  const mailer = createSmtpMailer(env);
  // Connects on the first queued mail, not here: see startMailQueue.
  const mailQueue = startMailQueue(env, {
    onError: (error) => logger.error({ err: error }, "Mail queue error"),
  });

  const stop = async () => {
    try {
      await app?.close();
      await notifications?.close();
      await mailQueue.stop();
      // A login code mail still in flight (sent without waiting) can be lost; no retries by design.
      mailer.close();
      await pool.end();
    } finally {
      // Last, and whatever a step above did, so an error while stopping (or the failed start)
      // is still sent.
      await closeMonitoring();
    }
  };

  try {
    notifications = await startNotificationHub({
      databaseUrl: env.DATABASE_URL,
      channels: [liveEventsChannel],
      logger,
    });
    app = await buildApp({
      env,
      db,
      notifications,
      mailer,
      queueMail: mailQueue.queueMail,
      logger,
      ...(monitoring ? { monitoring } : {}),
    });
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
    logger.info({ commit: env.GIT_COMMIT, environment: env.PADVINDER_ENVIRONMENT }, "API started");
  } catch (error) {
    logger.error({ err: error }, "API failed to start");
    await stop().catch((stopError) =>
      logger.error({ err: stopError }, "Cleanup after failed start failed"),
    );
    throw error;
  }
  return { app, stop };
}
