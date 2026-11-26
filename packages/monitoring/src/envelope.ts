import { parseEnvelope, serializeEnvelope, type Envelope } from "@sentry/core";
import { parseDsn } from "./dsn";
import { scrubEvent, scrubStrings } from "./scrub-event";
import type { DeploymentEnvironment } from "./settings";

/** The item types the browser SDK sends that we use. Replays, attachments and the rest are dropped. */
const KEPT_ITEM_TYPES = new Set(["event", "transaction", "session", "sessions", "client_report"]);
const EVENT_ITEM_TYPES = new Set(["event", "transaction"]);
const SESSION_ITEM_TYPES = new Set(["session", "sessions"]);
// Session attributes the browser SDK sets from the phone: its user agent, and "{{auto}}", which
// asks Sentry to store the sender's address.
const DROPPED_SESSION_ATTRIBUTES = ["user_agent", "ip_address"];
const DEFAULT_FORWARD_TIMEOUT_MS = 5_000;
// A full git commit: what a production build of the apps sends as its release. An installed app
// keeps running its old build until it is updated, so its release stays the browser's own.
const COMMIT_RELEASE = /^[0-9a-f]{40}$/;
// The SDK's own working data, never sent by a real SDK: from a browser it is just another field.
const SDK_PROCESSING_METADATA = "sdkProcessingMetadata";

type JsonObject = Record<string, unknown>;

export type BrowserEnvelopeOptions = {
  /** The server's DSN: it replaces whatever DSN the browser sent. */
  dsn: string;
  environment: DeploymentEnvironment;
  release: string;
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The browser's release when it is a full commit (its build), else the server's. */
function releaseFor(browserRelease: unknown, options: BrowserEnvelopeOptions): string {
  return typeof browserRelease === "string" && COMMIT_RELEASE.test(browserRelease)
    ? browserRelease
    : options.release;
}

function withoutSdkMetadata(object: JsonObject): JsonObject {
  const { [SDK_PROCESSING_METADATA]: _, ...rest } = object;
  return rest;
}

/** An item's payload as a JSON object, or null: parseEnvelope gives bytes for an item with a length. */
function jsonPayload(payload: unknown): JsonObject | null {
  if (payload instanceof Uint8Array) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(payload));
      return isJsonObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isJsonObject(payload) ? payload : null;
}

function prepareItem(type: string, payload: JsonObject, options: BrowserEnvelopeOptions) {
  // `scrubEvent` and `scrubStrings` pass `sdkProcessingMetadata` on untouched (the server SDK
  // never sends it), so it goes first, from every item type.
  const item = withoutSdkMetadata(payload);
  if (EVENT_ITEM_TYPES.has(type)) {
    return {
      ...scrubEvent(item),
      environment: options.environment,
      release: releaseFor(item.release, options),
    };
  }
  const scrubbed = scrubStrings(item);
  if (SESSION_ITEM_TYPES.has(type)) {
    const attrs = isJsonObject(scrubbed.attrs) ? { ...scrubbed.attrs } : {};
    for (const key of DROPPED_SESSION_ATTRIBUTES) delete attrs[key];
    return {
      ...scrubbed,
      attrs: {
        ...attrs,
        release: releaseFor(attrs.release, options),
        environment: options.environment,
      },
    };
  }
  return scrubbed;
}

/**
 * The envelope header: an allowlist, the server's DSN, and the trace without its user fields, with
 * the server's environment and the release as on the items.
 */
function prepareHeader(header: JsonObject, options: BrowserEnvelopeOptions): JsonObject {
  const prepared: JsonObject = { dsn: options.dsn };
  for (const key of ["event_id", "sent_at"]) {
    if (typeof header[key] === "string") prepared[key] = scrubStrings(header[key]);
  }
  if (isJsonObject(header.sdk)) prepared.sdk = scrubStrings(withoutSdkMetadata(header.sdk));
  if (isJsonObject(header.trace)) {
    const trace = Object.fromEntries(
      Object.entries(scrubStrings(withoutSdkMetadata(header.trace))).filter(
        ([key]) => !key.startsWith("user_"),
      ),
    );
    prepared.trace = {
      ...trace,
      public_key: parseDsn(options.dsn).publicKey,
      environment: options.environment,
      release: releaseFor(header.trace.release, options),
    };
  }
  return prepared;
}

/**
 * Makes an envelope from the browser SDK fit to forward: keeps only the item types we use (as
 * JSON objects, each with a fresh item header holding only its type), drops
 * `sdkProcessingMetadata` everywhere, scrubs every event and transaction with `scrubEvent` and sets
 * the server's environment on them (their `tags.service`, `app` or `portal`, stays as the browser
 * set it), does the same on sessions without the phone's user agent, scrubs the strings of
 * everything else, and puts the server's DSN in the header. The release (on events, transactions,
 * session attributes and the header's trace) stays the browser's when it is a full 40-character
 * commit, the build an installed app still runs, and is the server's otherwise ("dev", anything
 * else). Null for a body that is not an envelope or has no item left.
 */
export function prepareBrowserEnvelope(
  body: string | Uint8Array,
  options: BrowserEnvelopeOptions,
): Uint8Array | null {
  let envelope: Envelope;
  try {
    envelope = parseEnvelope(body);
  } catch {
    return null;
  }
  const [header, items] = envelope as unknown as [unknown, [unknown, unknown][]];
  if (!isJsonObject(header)) return null;
  const kept: [JsonObject, JsonObject][] = [];
  for (const [itemHeader, payload] of items) {
    if (!isJsonObject(itemHeader)) continue;
    const type = itemHeader.type;
    if (typeof type !== "string" || !KEPT_ITEM_TYPES.has(type)) continue;
    const json = jsonPayload(payload);
    if (json === null) continue;
    kept.push([{ type }, prepareItem(type, json, options)]);
  }
  if (kept.length === 0) return null;
  const serialized = serializeEnvelope([
    prepareHeader(header, options),
    kept,
  ] as unknown as Envelope);
  return typeof serialized === "string" ? new TextEncoder().encode(serialized) : serialized;
}

export type ForwardResult =
  | {
      status: number;
      /** Sentry's `Retry-After` and `X-Sentry-Rate-Limits`, for the browser SDK to back off. */
      retryAfter?: string;
      rateLimits?: string;
    }
  | { status: "unreachable" };

/**
 * Posts an envelope to the DSN's ingest address with only `Content-Type` of our own: no header of
 * the request it came from. The key in the query is what Sentry's own transport sends; it also
 * makes the server SDK's fetch instrumentation see a request to Sentry, so it adds no trace
 * headers, span or breadcrumb. `unreachable` when no answer came within the timeout.
 */
export async function forwardEnvelope(
  envelope: Uint8Array,
  dsn: string,
  options: { timeoutMs?: number } = {},
): Promise<ForwardResult> {
  const { ingestUrl, publicKey } = parseDsn(dsn);
  try {
    const response = await fetch(`${ingestUrl}?sentry_version=7&sentry_key=${publicKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      // A copy backed by a plain ArrayBuffer, which is what the DOM typings of `fetch` accept.
      body: new Uint8Array(envelope),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_FORWARD_TIMEOUT_MS),
    });
    await response.body?.cancel();
    const retryAfter = response.headers.get("retry-after");
    const rateLimits = response.headers.get("x-sentry-rate-limits");
    return {
      status: response.status,
      ...(retryAfter !== null && { retryAfter }),
      ...(rateLimits !== null && { rateLimits }),
    };
  } catch {
    return { status: "unreachable" };
  }
}
