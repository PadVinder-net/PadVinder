import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { parseEnvelope, type Envelope, type Event } from "@sentry/core";

/** The payloads of the items of one type in a list of envelopes. */
export function itemsOfType(envelopes: readonly Envelope[], type: string): Event[] {
  return envelopes.flatMap(([, items]) =>
    items.filter(([header]) => header.type === type).map(([, payload]) => payload as Event),
  );
}

/** One request the fake server received, whatever its answer. */
export type FakeSentryRequest = { method: string; url: string; headers: IncomingHttpHeaders };

/**
 * A Sentry ingest server on 127.0.0.1 that answers 200 to every envelope (or what `answerWith`
 * set) and keeps its decoded body and every request's headers. Point a process at it with
 * `SENTRY_DSN` set to `dsn`.
 */
export async function startFakeSentry(): Promise<{
  dsn: string;
  bodies(): string[];
  /** Every request, also the ones answered with an error, in order. */
  requests(): FakeSentryRequest[];
  envelopes(): Envelope[];
  events(): Event[];
  transactions(): Event[];
  /** The answer to the next envelopes: a status and response headers. Default 200. */
  answerWith(status: number, headers?: Record<string, string>): void;
  close(): Promise<void>;
}> {
  const bodies: string[] = [];
  const requests: FakeSentryRequest[] = [];
  let answer: { status: number; headers: Record<string, string> } = { status: 200, headers: {} };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: { ...request.headers },
      });
      const isEnvelope =
        request.method === "POST" && /^\/api\/[^/]+\/envelope\/(\?|$)/.test(request.url ?? "");
      const accepted = isEnvelope && answer.status >= 200 && answer.status < 300;
      if (accepted) {
        const raw = Buffer.concat(chunks);
        const gzipped = request.headers["content-encoding"] === "gzip";
        bodies.push((gzipped ? gunzipSync(raw) : raw).toString("utf8"));
      }
      response.writeHead(isEnvelope ? answer.status : 404, {
        "content-type": "application/json",
        ...(isEnvelope ? answer.headers : {}),
      });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const envelopes = () => bodies.map((body) => parseEnvelope(body));
  return {
    dsn: `http://public@127.0.0.1:${port}/1`,
    bodies: () => [...bodies],
    requests: () => [...requests],
    envelopes,
    events: () => itemsOfType(envelopes(), "event"),
    transactions: () => itemsOfType(envelopes(), "transaction"),
    answerWith(status, headers = {}) {
      answer = { status, headers };
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
