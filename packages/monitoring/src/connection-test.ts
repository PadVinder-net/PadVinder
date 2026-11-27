import { randomUUID } from "node:crypto";
import { scrub } from "@padvinder/logging";
import { parseDsn } from "./dsn";

const DEFAULT_TIMEOUT_MS = 10_000;
/** How much of a refusing answer without a `<title>` is kept. */
const ANSWER_LENGTH = 200;
/** How much of a body is read at most: enough for a title or the start of an error page. */
const MAX_BODY_BYTES = 64 * 1024;

export type SentryConnectionResult = {
  family: 4 | 6;
  /** Sentry's HTTP status, or `unreachable` when no answer came. */
  status: number | "unreachable";
  /**
   * For a refusal (not 2xx): the HTML page's `<title>`, or else the start of the body, scrubbed.
   * For `unreachable`: the network error's code (`ENETUNREACH`, `ENOTFOUND`, …) or `TimeoutError`.
   */
  answer?: string;
};

function envelopeFor(dsn: string, family: 4 | 6, service: string | undefined): string {
  const eventId = randomUUID().replaceAll("-", "");
  const now = new Date();
  return [
    JSON.stringify({ event_id: eventId, sent_at: now.toISOString(), dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({
      event_id: eventId,
      timestamp: now.getTime() / 1000,
      level: "info",
      platform: "node",
      message: `Sentry connection test over IPv${family}`,
      ...(service !== undefined && { tags: { service } }),
    }),
  ].join("\n");
}

/** The refusing page's title, or the start of its body; scrubbed, and never with the key. */
function answerFrom(body: string, publicKey: string): string | undefined {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim();
  const text = title || body.slice(0, ANSWER_LENGTH).trim();
  if (text === "") return undefined;
  return scrub(text).replaceAll(publicKey, "[key]");
}

/** A short, non-personal name for why a request got no answer. */
function unreachableReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  if (error instanceof Error) return error.name;
  return "unknown";
}

/**
 * Sends one plain test event to the DSN's ingest address over IPv4 or IPv6 only (the `family` of
 * Node's `https.request`, or `http.request` for an `http:` DSN), to see whether this machine
 * reaches Sentry over that address family. The status is Sentry's (or its front end's) answer;
 * `unreachable` when none came within the timeout. Never throws; the result never holds the DSN
 * or its key.
 */
export async function testSentryConnection(
  dsn: string,
  family: 4 | 6,
  options: { timeoutMs?: number; service?: string } = {},
): Promise<SentryConnectionResult> {
  let publicKey: string;
  let url: URL;
  try {
    const parsed = parseDsn(dsn);
    publicKey = parsed.publicKey;
    url = new URL(`${parsed.ingestUrl}?sentry_version=7&sentry_key=${publicKey}`);
  } catch (error) {
    return { family, status: "unreachable", answer: unreachableReason(error) };
  }
  const body = envelopeFor(dsn, family, options.service);
  // Loaded here, not at the top: the services load this package before Sentry starts.
  const { request } =
    url.protocol === "http:" ? await import("node:http") : await import("node:https");

  return new Promise<SentryConnectionResult>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (result: SentryConnectionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const fail = (error: unknown) =>
      settle({ family, status: "unreachable", answer: unreachableReason(error) });

    const outgoing = request(
      url,
      {
        method: "POST",
        family,
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 200 && status <= 299) {
          response.resume();
          settle({ family, status });
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        const finish = () => {
          const answer = answerFrom(Buffer.concat(chunks).toString("utf8"), publicKey);
          settle({ family, status, ...(answer !== undefined && { answer }) });
          response.destroy();
        };
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          length += chunk.length;
          if (length >= MAX_BODY_BYTES) finish();
        });
        response.on("end", finish);
        response.on("error", finish);
      },
    );
    timer = setTimeout(() => {
      settle({ family, status: "unreachable", answer: "TimeoutError" });
      outgoing.destroy();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    outgoing.on("error", fail);
    outgoing.end(body);
  });
}
