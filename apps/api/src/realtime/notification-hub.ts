import type { NotificationChannel } from "@padvinder/db";
import type { FastifyBaseLogger } from "fastify";
import pg from "pg";
import type { z } from "zod";

/** Fan-out of PostgreSQL `LISTEN`/`NOTIFY` notifications to in-process listeners (used by SSE). */
export interface NotificationHub {
  /**
   * Calls the listener with each event on the channel, already parsed with the channel's schema.
   * Returns a function that removes the listener again.
   */
  subscribe<S extends z.ZodType>(
    channel: NotificationChannel<S>,
    listener: (event: z.output<S>) => void,
  ): () => void;
  listenerCount(channel: NotificationChannel): number;
  close(): Promise<void>;
}

/** Subscribes to nothing. For tests and OpenAPI generation. */
export function createNoopNotificationHub(): NotificationHub {
  return {
    subscribe: () => () => {},
    listenerCount: () => 0,
    close: async () => {},
  };
}

export type NotificationHubOptions = {
  databaseUrl: string;
  channels: NotificationChannel[];
  logger: FastifyBaseLogger;
  /** Wait before the first reconnect attempt; it doubles with each failed attempt. Default 5000. */
  reconnectDelayMs?: number;
  /** Upper limit of the wait between reconnect attempts. Default 30000. */
  maxReconnectDelayMs?: number;
  /** How often to check the connection with `select 1`. Default 30000. */
  livenessCheckIntervalMs?: number;
  /** How long that check may take before the connection counts as lost. Default 10000. */
  livenessCheckTimeoutMs?: number;
};

const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_LIVENESS_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_LIVENESS_CHECK_TIMEOUT_MS = 10_000;

/**
 * Listens on the given channels with one dedicated connection (not from the pool, and on port
 * 5432: pgBouncer breaks LISTEN). It parses each payload once with the channel's schema and fans the
 * event out to subscribers; an invalid payload is logged and dropped.
 *
 * A `select 1` liveness check notices a connection that stays open but no longer answers, which TCP
 * keepalive misses when something in between (a proxy, a NAT) still acknowledges. When the
 * connection drops or the liveness check fails, it reconnects with a doubling, capped delay until
 * `close()`. Notifications sent while it was down are lost; SSE clients only see live events.
 *
 * Resolves after the first connect attempt, also when it fails: the API must start while the
 * database is down (`/api/health` reports that), so a failed first connect logs a warning and
 * enters the same reconnect loop.
 */
export async function startNotificationHub(
  options: NotificationHubOptions,
): Promise<NotificationHub> {
  const { databaseUrl, channels, logger } = options;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const maxReconnectDelayMs = options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS;
  const livenessCheckIntervalMs =
    options.livenessCheckIntervalMs ?? DEFAULT_LIVENESS_CHECK_INTERVAL_MS;
  const livenessCheckTimeoutMs =
    options.livenessCheckTimeoutMs ?? DEFAULT_LIVENESS_CHECK_TIMEOUT_MS;
  const channelsByName = new Map(channels.map((channel) => [channel.name, channel]));
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  let current: pg.Client | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;
  /** Failed attempts since the last successful connect. */
  let attempt = 0;
  /** Waits for the next liveness check, or for the answer to the current one. */
  let livenessTimer: NodeJS.Timeout | undefined;
  let closed = false;

  const stopLivenessCheck = () => {
    clearTimeout(livenessTimer);
    livenessTimer = undefined;
  };

  // Detects a connection that stays open but no longer answers; it does not keep the connection
  // alive (TCP keepalive and the SSE keepalive do that).
  const scheduleLivenessCheck = (client: pg.Client) => {
    livenessTimer = setTimeout(() => {
      livenessTimer = setTimeout(
        () =>
          lost(
            client,
            new Error(`Liveness check got no answer within ${livenessCheckTimeoutMs} ms`),
          ),
        livenessCheckTimeoutMs,
      );
      client.query("select 1").then(
        () => {
          if (client !== current) return;
          stopLivenessCheck();
          scheduleLivenessCheck(client);
        },
        (error: Error) => lost(client, error),
      );
    }, livenessCheckIntervalMs);
  };

  /** Ends a client for good. The no-op `error` handler keeps a late error from crashing us. */
  const discard = async (client: pg.Client): Promise<void> => {
    client.removeAllListeners();
    client.on("error", () => {});
    await client.end().catch(() => {});
  };

  const connect = async (): Promise<pg.Client> => {
    const client = new pg.Client({
      connectionString: databaseUrl,
      application_name: "padvinder-notifications",
      // Without a timeout, a database that drops packets or accepts TCP but never answers keeps
      // connect() pending for minutes or forever, and the API would never start listening.
      // Same value as the pool in packages/db/src/client.ts.
      connectionTimeoutMillis: 2_000,
      // Without TCP keepalive a half-open connection (no FIN or RST) is never noticed, and SSE
      // would go quiet while only keepalive comments continue.
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });
    // Until `current` is set, errors surface through connect()/query() rejections instead.
    client.on("error", (error) => lost(client, error));
    client.on("end", () => lost(client));
    client.on("notification", (message) => {
      const channel = channelsByName.get(message.channel);
      const subscribers = listeners.get(message.channel);
      if (!channel || !subscribers?.size) return;
      let event: unknown;
      try {
        event = channel.schema.parse(JSON.parse(message.payload ?? ""));
      } catch (error) {
        logger.warn({ err: error, channel: channel.name }, "Dropped an invalid notification");
        return;
      }
      for (const listener of subscribers) {
        try {
          listener(event);
        } catch (error) {
          logger.error({ err: error, channel: message.channel }, "Notification listener failed");
        }
      }
    });
    try {
      await client.connect();
      // defineChannel() only accepts plain lowercase identifiers, so the name needs no quoting.
      for (const channel of channels) await client.query(`LISTEN ${channel.name}`);
    } catch (error) {
      await discard(client);
      throw error;
    }
    if (closed) {
      await discard(client);
    } else {
      current = client;
      attempt = 0;
      scheduleLivenessCheck(client);
    }
    return client;
  };

  /** Logs the failure with the wait until the next attempt, then schedules that attempt. */
  const retry = (message: string, error?: unknown) => {
    if (closed || reconnectTimer) return;
    // The exponent is capped so the product stays finite (and not NaN when the delay is 0).
    const delayMs = Math.min(reconnectDelayMs * 2 ** Math.min(attempt, 30), maxReconnectDelayMs);
    attempt += 1;
    logger.warn({ err: error, retryInMs: delayMs }, message);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = undefined;
      try {
        await connect();
        if (!closed) logger.info("Notification listener reconnected");
      } catch (error) {
        retry("Notification listener could not reconnect", error);
      }
    }, delayMs);
  };

  function lost(client: pg.Client, error?: Error): void {
    if (client !== current) return;
    current = undefined;
    stopLivenessCheck();
    void discard(client);
    retry("Notification listener connection lost", error);
  }

  try {
    await connect();
  } catch (error) {
    retry("Notification listener could not connect, retrying", error);
  }

  return {
    subscribe(channel, listener) {
      // The hub parses with its own channel definition, so the listener's type must match it.
      if (channelsByName.get(channel.name) !== channel) {
        throw new Error(`The notification hub does not listen on channel ${channel.name}`);
      }
      let set = listeners.get(channel.name);
      if (!set) listeners.set(channel.name, (set = new Set()));
      const untyped = listener as (event: unknown) => void;
      set.add(untyped);
      return () => {
        set.delete(untyped);
      };
    },
    listenerCount: (channel) => listeners.get(channel.name)?.size ?? 0,
    async close() {
      closed = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      stopLivenessCheck();
      const client = current;
      current = undefined;
      if (client) await discard(client);
    },
  };
}
