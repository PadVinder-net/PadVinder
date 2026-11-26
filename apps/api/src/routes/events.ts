import { liveEventAudiences, type LiveEvent } from "@padvinder/contracts";
import { type Db, liveEventsChannel } from "@padvinder/db";
import type { ServerResponse } from "node:http";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { type Actor, loadActor } from "../permissions/actor";
import { addressOf, shouldDeliver } from "../realtime/audience";
import type { NotificationHub } from "../realtime/notification-hub";

/** Below the 30 to 60 s idle timeouts of common proxies. */
export const SSE_KEEPALIVE_MS = 25_000;
/** How long a browser waits before reconnecting. Stated explicitly instead of the default. */
const SSE_RETRY_MS = 5_000;
/** How often an open stream checks that its session still exists (the design: at least every 5 minutes). */
export const SESSION_RECHECK_MS = 300_000;

export const eventsRoutes: FastifyPluginAsyncZod<{
  db: Db;
  notifications: NotificationHub;
  sessionRecheckMs: number;
}> = async (app, { db, notifications, sessionRecheckMs }) => {
  const open = new Set<ServerResponse>();

  // Open streams would keep the server (and so the process) alive. `preClose` runs before the
  // server stops accepting connections; an `onClose` hook would run too late and hang.
  app.addHook("preClose", async () => {
    for (const raw of open) raw.end();
  });

  // Needs a login (401 before the stream opens). Each event goes only to the connections of its
  // audience (the design, "Live events"); the stream checks its session every `sessionRecheckMs`
  // and reloads its rights when an `access-changed` event for its user passes.
  app.get(
    "/events",
    { preHandler: app.requireActor, schema: { hide: true } },
    async (request, reply) => {
      // A renewed session's cookie, set by `requireActor`; hijacking skips Fastify's own headers.
      const sessionCookie = reply.getHeader("set-cookie");
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        ...(sessionCookie !== undefined && { "Set-Cookie": sessionCookie as string | string[] }),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      open.add(raw);

      // Set by `requireActor`. Replaced by every successful load, so changed rights take effect.
      let actor: Actor = request.actor!;
      let ended = false;

      const write = (chunk: string) => {
        if (!raw.writable || raw.writableEnded) return;
        raw.write(chunk);
      };

      // Loads the actor again from the stream's own cookie: every `sessionRecheckMs`, and when an
      // `access-changed` event for this user passes. No actor any more (the session or the account
      // is gone) ends the stream; the browser's reconnect then gets a 401. A database failure
      // keeps the old actor: ending the stream would make every open app reconnect at once while
      // the database is struggling. Loads may overlap (a check is running when an event needs a
      // reload); each one is numbered when it starts, and a load never replaces the actor of a
      // load that started after it, so an older answer cannot overwrite a newer one.
      let loadsStarted = 0;
      let newestApplied = 0;
      let loading = 0;
      const reload = async () => {
        const number = ++loadsStarted;
        loading++;
        try {
          // Not the Sentry user: a reload runs from a notification or a timer, outside the request.
          const fresh = await loadActor(app, db, request, { identify: false });
          if (ended || number < newestApplied) return;
          newestApplied = number;
          if (fresh === null) end();
          else actor = fresh;
        } catch (error) {
          if (ended) return;
          // No personal data: no cookie, no user, only what kind of failure it was.
          const code = (error as { code?: unknown }).code;
          request.log.warn(
            {
              errorName: (error as Error).name,
              ...(typeof code === "string" && { errorCode: code }),
            },
            "Live events session check failed; keeping the stream open",
          );
        } finally {
          loading--;
        }
      };

      // Events are handled one at a time, in order: an `access-changed` for this user reloads
      // the actor before anything is decided about it or about the events after it. The event is
      // then delivered with the fresh actor, or with the old one if the database failed.
      let queue = Promise.resolve();
      const handle = async (event: LiveEvent) => {
        if (ended) return;
        if (event.type === "access-changed" && event.userId === actor.userId) {
          await reload();
          if (ended) return;
        }
        if (!shouldDeliver(actor, liveEventAudiences[event.type], addressOf(event))) return;
        write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };
      // The hub has already validated the event against the channel's schema.
      const unsubscribe = notifications.subscribe(liveEventsChannel, (event) => {
        queue = queue
          .then(() => handle(event))
          .catch((error: unknown) => {
            request.log.error({ errorName: (error as Error).name }, "Live event not handled");
          });
      });
      const keepalive = setInterval(() => write(": keepalive\n\n"), SSE_KEEPALIVE_MS);

      // The periodic check skips a turn while a load is still running; that load is fresh enough.
      const recheck = setInterval(() => {
        if (loading === 0 && !ended) void reload();
      }, sessionRecheckMs);

      const cleanup = () => {
        if (ended) return;
        ended = true;
        clearInterval(keepalive);
        clearInterval(recheck);
        unsubscribe();
        open.delete(raw);
      };
      const end = () => {
        cleanup();
        raw.end();
      };
      request.raw.on("close", cleanup);
      raw.on("close", cleanup);
      // A write to a dead socket emits 'error'; without a listener that would crash the process.
      raw.on("error", cleanup);

      write(`retry: ${SSE_RETRY_MS}\n\n`);
    },
  );
};
