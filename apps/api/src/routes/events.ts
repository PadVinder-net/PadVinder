import { liveEventAudiences } from "@padvinder/contracts";
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
  // audience (the design, "Live events"); the stream checks its session every `sessionRecheckMs`.
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

      // Set by `requireActor`. Replaced by every successful check, so changed rights take effect.
      let actor: Actor = request.actor!;
      let ended = false;

      const write = (chunk: string) => {
        if (!raw.writable || raw.writableEnded) return;
        raw.write(chunk);
      };

      // The hub has already validated the event against the channel's schema.
      const unsubscribe = notifications.subscribe(liveEventsChannel, (event) => {
        if (!shouldDeliver(actor, liveEventAudiences[event.type], addressOf(event))) return;
        write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const keepalive = setInterval(() => write(": keepalive\n\n"), SSE_KEEPALIVE_MS);

      // Loads the actor again from the stream's own cookie. A session that is gone ends the
      // stream; the browser's reconnect then gets a 401. A database failure keeps the old actor
      // and tries again at the next interval: ending the stream would make every open app
      // reconnect at once while the database is struggling.
      let checking = false;
      const check = async () => {
        if (checking || ended) return;
        checking = true;
        try {
          const fresh = await loadActor(app, db, request);
          if (ended) return;
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
          checking = false;
        }
      };
      const recheck = setInterval(() => void check(), sessionRecheckMs);

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
