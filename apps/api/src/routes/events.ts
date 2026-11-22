import { liveEventsChannel } from "@padvinder/db";
import type { ServerResponse } from "node:http";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { NotificationHub } from "../realtime/notification-hub";

/** Below the 30 to 60 s idle timeouts of common proxies. */
export const SSE_KEEPALIVE_MS = 25_000;
/** How long a browser waits before reconnecting. Stated explicitly instead of the default. */
const SSE_RETRY_MS = 5_000;

export const eventsRoutes: FastifyPluginAsyncZod<{ notifications: NotificationHub }> = async (
  app,
  { notifications },
) => {
  const open = new Set<ServerResponse>();

  // Open streams would keep the server (and so the process) alive. `preClose` runs before the
  // server stops accepting connections; an `onClose` hook would run too late and hang.
  app.addHook("preClose", async () => {
    for (const raw of open) raw.end();
  });

  // Needs a login (401 before the stream opens). Not yet filtered per audience: that comes with
  // the first event that is not a worker heartbeat (the design, "Live events").
  app.get(
    "/events",
    { preHandler: app.requireActor, schema: { hide: true } },
    async (request, reply) => {
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      open.add(raw);

      const write = (chunk: string) => {
        if (!raw.writable || raw.writableEnded) return;
        raw.write(chunk);
      };

      // The hub has already validated the event against the channel's schema.
      const unsubscribe = notifications.subscribe(liveEventsChannel, (event) => {
        write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const keepalive = setInterval(() => write(": keepalive\n\n"), SSE_KEEPALIVE_MS);

      const cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
        open.delete(raw);
      };
      request.raw.on("close", cleanup);
      // A write to a dead socket emits 'error'; without a listener that would crash the process.
      raw.on("error", cleanup);

      write(`retry: ${SSE_RETRY_MS}\n\n`);
    },
  );
};
