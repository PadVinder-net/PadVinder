import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { parseEnvelope, type Envelope, type Event } from "@sentry/core";

/** The payloads of the items of one type in a list of envelopes. */
export function itemsOfType(envelopes: readonly Envelope[], type: string): Event[] {
  return envelopes.flatMap(([, items]) =>
    items.filter(([header]) => header.type === type).map(([, payload]) => payload as Event),
  );
}

/**
 * A Sentry ingest server on 127.0.0.1 that answers 200 to every envelope and keeps its decoded
 * body. Point a process at it with `SENTRY_DSN` set to `dsn`.
 */
export async function startFakeSentry(): Promise<{
  dsn: string;
  bodies(): string[];
  events(): Event[];
  transactions(): Event[];
  close(): Promise<void>;
}> {
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const accepted =
        request.method === "POST" && /^\/api\/[^/]+\/envelope\/(\?|$)/.test(request.url ?? "");
      if (accepted) {
        const raw = Buffer.concat(chunks);
        const gzipped = request.headers["content-encoding"] === "gzip";
        bodies.push((gzipped ? gunzipSync(raw) : raw).toString("utf8"));
      }
      response.writeHead(accepted ? 200 : 404, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const envelopes = () => bodies.map((body) => parseEnvelope(body));
  return {
    dsn: `http://public@127.0.0.1:${port}/1`,
    bodies: () => [...bodies],
    events: () => itemsOfType(envelopes(), "event"),
    transactions: () => itemsOfType(envelopes(), "transaction"),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
