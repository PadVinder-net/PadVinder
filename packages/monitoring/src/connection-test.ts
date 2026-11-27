import { randomUUID } from "node:crypto";
import { scrub } from "@padvinder/logging";
import { parseDsn } from "./dsn";
import { postToSentry, requestErrorReason } from "./sentry-request";

const DEFAULT_TIMEOUT_MS = 10_000;
/** How much of a refusing answer without a `<title>` is kept. */
const ANSWER_LENGTH = 200;

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

export type SentryConnectionTestOptions = {
  /** Default 10,000 ms, for the connection and the answer together. */
  timeoutMs?: number;
  /** The `service` tag of the test event (`api`). */
  service?: string;
  /** Set on the test event, so staging's and production's tests tell apart in one project. */
  environment?: string;
  release?: string;
};

function envelopeFor(dsn: string, family: 4 | 6, options: SentryConnectionTestOptions): string {
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
      ...(options.environment !== undefined && { environment: options.environment }),
      ...(options.release !== undefined && { release: options.release }),
      ...(options.service !== undefined && { tags: { service: options.service } }),
    }),
  ].join("\n");
}

/**
 * The refusing page's title, or the start of its body; never with an address or the key. The whole
 * body is cleaned before it is cut, so nothing that crosses the cut survives in part.
 */
function answerFrom(body: string, publicKey: string): string | undefined {
  const clean = scrub(body).replaceAll(publicKey, "[key]");
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(clean)?.[1]?.trim();
  const text = title || clean.slice(0, ANSWER_LENGTH).trim();
  return text === "" ? undefined : text;
}

/**
 * Sends one plain test event to the DSN's ingest address over IPv4 or IPv6 only (`postToSentry`,
 * the same request as the tunnel's and the problem reports', with the family given instead of
 * `SENTRY_ADDRESS_FAMILY`), to see whether this machine reaches Sentry over that address family. The status is Sentry's (or its front end's) answer;
 * `unreachable` when none came within the timeout. Never throws; the result never holds the DSN
 * or its key.
 */
export async function testSentryConnection(
  dsn: string,
  family: 4 | 6,
  options: SentryConnectionTestOptions = {},
): Promise<SentryConnectionResult> {
  let publicKey: string;
  let url: URL;
  try {
    const parsed = parseDsn(dsn);
    publicKey = parsed.publicKey;
    url = new URL(`${parsed.ingestUrl}?sentry_version=7&sentry_key=${publicKey}`);
  } catch (error) {
    return { family, status: "unreachable", answer: requestErrorReason(error) };
  }
  const result = await postToSentry(url, envelopeFor(dsn, family, options), {
    family,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if ("error" in result) return { family, status: "unreachable", answer: result.error };
  if (result.status >= 200 && result.status <= 299) return { family, status: result.status };
  const answer = answerFrom(result.body, publicKey);
  return { family, status: result.status, ...(answer !== undefined && { answer }) };
}
