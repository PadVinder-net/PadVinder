import { parseEnvelope, type Envelope } from "@sentry/core";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { forwardEnvelope, prepareBrowserEnvelope } from "./envelope";
import { startFakeSentry } from "./testing";

const SERVER_DSN = "https://serverkey@o1.ingest.sentry.test/42";
const options = { dsn: SERVER_DSN, environment: "staging", release: "abc123" } as const;

function envelopeOf(header: unknown, ...items: [unknown, unknown][]): string {
  return [
    JSON.stringify(header),
    ...items.flatMap(([itemHeader, payload]) => [
      JSON.stringify(itemHeader),
      typeof payload === "string" ? payload : JSON.stringify(payload),
    ]),
  ].join("\n");
}

const browserHeader = {
  event_id: "9ec79c33ec9942ab8353589fcb2e04dc",
  sent_at: "2026-11-26T10:00:00.000Z",
  dsn: "https://foreignkey@o9.ingest.sentry.io/99",
  sdk: { name: "sentry.javascript.react", version: "11.18.0" },
  trace: {
    trace_id: "771a43a4192642f0b136d5159a501700",
    public_key: "foreignkey",
    environment: "browser-env",
    release: "browser-release",
    user_segment: "vip",
    user_id: "u1",
    transaction: "/app/more/profile",
    sampled: "true",
  },
};

function prepared(body: string): Envelope {
  const result = prepareBrowserEnvelope(body, options);
  if (result === null) throw new Error("expected an envelope");
  return parseEnvelope(result);
}

test("replaces the DSN, keeps an allowlist of header fields and drops the trace's user fields", () => {
  const [header] = prepared(
    envelopeOf({ ...browserHeader, extra: "x" }, [{ type: "client_report" }, { a: 1 }]),
  );
  expect(header).toEqual({
    event_id: browserHeader.event_id,
    sent_at: browserHeader.sent_at,
    dsn: SERVER_DSN,
    sdk: browserHeader.sdk,
    trace: {
      trace_id: browserHeader.trace.trace_id,
      public_key: "serverkey",
      environment: "staging",
      release: "abc123",
      transaction: "/app/more/profile",
      sampled: "true",
    },
  });
});

test("an event: scrubbed, with the server's environment and release and the browser's service tag", () => {
  const [, items] = prepared(
    envelopeOf(browserHeader, [
      { type: "event", length: 999 },
      {
        message: "send to noor@example.test failed",
        environment: "browser-env",
        release: "browser-release",
        tags: { service: "portal" },
        sdkProcessingMetadata: { note: "z@w.test" },
        user: { id: "u1", ip_address: "{{auto}}", email: "x@y.test" },
        request: {
          url: "https://padvinder.test/app/?email=a%40b.test",
          headers: { "User-Agent": "UA" },
        },
        breadcrumbs: [{ category: "fetch", data: { url: "/api/me?email=a%40b.test" } }],
      },
    ]),
  );
  expect(items).toEqual([
    [
      { type: "event" },
      {
        message: "send to [email] failed",
        environment: "staging",
        release: "abc123",
        tags: { service: "portal" },
        user: { id: "u1" },
        request: { url: "https://padvinder.test/app/" },
        breadcrumbs: [{ category: "fetch", data: { url: "/api/me" } }],
      },
    ],
  ]);
});

test("a transaction: scrubbed, with the server's environment and release", () => {
  const [, items] = prepared(
    envelopeOf(browserHeader, [
      { type: "transaction" },
      {
        type: "transaction",
        transaction: "/app/more/profile",
        environment: "x",
        tags: { service: "app" },
        contexts: { trace: { data: { "user_agent.original": "UA", "url.full": "/api/x?q=1" } } },
        spans: [{ description: "GET /api/x?email=p%40q.test", data: { "url.query": "?a=1" } }],
      },
    ]),
  );
  expect(items).toEqual([
    [
      { type: "transaction" },
      {
        type: "transaction",
        transaction: "/app/more/profile",
        environment: "staging",
        release: "abc123",
        tags: { service: "app" },
        contexts: { trace: { data: { "url.full": "/api/x" } } },
        spans: [{ description: "GET /api/x?email=[email]", data: {} }],
      },
    ],
  ]);
});

test("a session: the server's environment and release, without user agent or IP address", () => {
  const [, items] = prepared(
    envelopeOf(browserHeader, [
      { type: "session" },
      {
        sid: "s1",
        did: "someone@example.test",
        status: "ok",
        attrs: {
          release: "browser-release",
          environment: "browser-env",
          user_agent: "UA-MARKER",
          ip_address: "{{auto}}",
        },
      },
    ]),
  );
  expect(items).toEqual([
    [
      { type: "session" },
      {
        sid: "s1",
        did: "[email]",
        status: "ok",
        attrs: { release: "abc123", environment: "staging" },
      },
    ],
  ]);
});

test("session aggregates: the server's environment and release", () => {
  const [, items] = prepared(
    envelopeOf(browserHeader, [
      { type: "sessions" },
      { aggregates: [{ started: "2026-11-26T10:00:00Z", exited: 1 }] },
    ]),
  );
  expect(items).toEqual([
    [
      { type: "sessions" },
      {
        aggregates: [{ started: "2026-11-26T10:00:00Z", exited: 1 }],
        attrs: { release: "abc123", environment: "staging" },
      },
    ],
  ]);
});

test("a client report: kept, its strings scrubbed", () => {
  const report = {
    timestamp: 1,
    discarded_events: [{ reason: "x@y.test", category: "error", quantity: 2 }],
  };
  const [, items] = prepared(envelopeOf(browserHeader, [{ type: "client_report" }, report]));
  expect(items).toEqual([
    [
      { type: "client_report" },
      { timestamp: 1, discarded_events: [{ reason: "[email]", category: "error", quantity: 2 }] },
    ],
  ]);
});

test("drops every other item type, and items that are not a JSON object", () => {
  const body = envelopeOf(
    browserHeader,
    [{ type: "replay_event" }, { replay_id: "r" }],
    [{ type: "replay_recording", length: 5 }, "abcde"],
    [{ type: "attachment", length: 3, filename: "a.txt" }, "abc"],
    [{ type: "feedback" }, { contexts: { feedback: { message: "m" } } }],
    [{ type: "profile" }, { x: 1 }],
    [{ type: "event" }, [1, 2]],
    [{ type: "event", length: 3 }, "abc"],
    [{ type: "client_report" }, { timestamp: 1 }],
  );
  const [, items] = prepared(body);
  expect(items).toEqual([[{ type: "client_report" }, { timestamp: 1 }]]);
});

test("reads an event item given with a length", () => {
  const payload = JSON.stringify({ message: "m" });
  const body = `${JSON.stringify(browserHeader)}\n${JSON.stringify({ type: "event", length: Buffer.byteLength(payload) })}\n${payload}`;
  const [, items] = prepared(body);
  expect(items).toEqual([
    [{ type: "event" }, { message: "m", environment: "staging", release: "abc123" }],
  ]);
});

test.each([
  ["garbage", "this is not an envelope"],
  ["empty", ""],
  ["a header without items", JSON.stringify(browserHeader)],
  ["a header that is not an object", '123\n{"type":"event"}\n{}'],
  ["invalid JSON in an item", `${JSON.stringify(browserHeader)}\n{"type":"event"}\n{not json`],
  ["only dropped items", envelopeOf(browserHeader, [{ type: "replay_event" }, {}])],
])("returns null for %s", (_, body) => {
  expect(prepareBrowserEnvelope(body, options)).toBeNull();
});

test("accepts bytes as well as text", () => {
  const body = new TextEncoder().encode(
    envelopeOf(browserHeader, [{ type: "client_report" }, { timestamp: 1 }]),
  );
  expect(prepareBrowserEnvelope(body, options)).toBeInstanceOf(Uint8Array);
});

let fake: Awaited<ReturnType<typeof startFakeSentry>> | undefined;

beforeAll(async () => {
  fake = await startFakeSentry();
});

afterAll(async () => {
  await fake?.close();
});

beforeEach(() => {
  fake?.answerWith(200);
});

test("forwardEnvelope posts the envelope to the DSN's ingest address with only our headers", async () => {
  const envelope = new TextEncoder().encode(
    envelopeOf({ dsn: fake!.dsn }, [{ type: "client_report" }, { timestamp: 1 }]),
  );
  const before = fake!.requests().length;
  expect(await forwardEnvelope(envelope, fake!.dsn)).toEqual({ status: 200 });
  const request = fake!.requests()[before]!;
  expect(request.method).toBe("POST");
  expect(request.url).toBe("/api/1/envelope/?sentry_version=7&sentry_key=public");
  expect(request.headers["content-type"]).toBe("application/x-sentry-envelope");
  expect(request.headers.cookie).toBeUndefined();
  expect(request.headers["x-forwarded-for"]).toBeUndefined();
  expect(fake!.bodies().at(-1)).toBe(new TextDecoder().decode(envelope));
});

test("forwardEnvelope passes Sentry's status and rate limit headers on", async () => {
  fake!.answerWith(429, { "retry-after": "60", "x-sentry-rate-limits": "60:error:key" });
  expect(await forwardEnvelope(new Uint8Array([123, 125]), fake!.dsn)).toEqual({
    status: 429,
    retryAfter: "60",
    rateLimits: "60:error:key",
    detail: "{}",
  });
});

test("forwardEnvelope keeps Sentry's reason when it refuses, scrubbed and cut to 300 characters", async () => {
  fake!.answerWith(
    403,
    {},
    `{"detail":"event submission rejected with_reason: ProjectId","to":"noor@example.test"}${"x".repeat(400)}`,
  );
  const result = await forwardEnvelope(new Uint8Array([123, 125]), fake!.dsn);
  expect(result).toMatchObject({ status: 403 });
  const detail = (result as { detail?: string }).detail ?? "";
  expect(detail).toContain("event submission rejected with_reason: ProjectId");
  expect(detail).not.toContain("noor@example.test");
  expect(detail.length).toBeLessThanOrEqual(300);
});

test("forwardEnvelope keeps no body for an accepted envelope", async () => {
  fake!.answerWith(200, {}, '{"id":"abc"}');
  expect(await forwardEnvelope(new Uint8Array([123, 125]), fake!.dsn)).toEqual({ status: 200 });
});

test("forwardEnvelope answers unreachable for a closed port and after its timeout", async () => {
  const closed = await startFakeSentry();
  await closed.close();
  expect(await forwardEnvelope(new Uint8Array([1]), closed.dsn)).toEqual({
    status: "unreachable",
    reason: "ECONNREFUSED",
  });
  // A server that accepts the connection and never answers: the timeout ends the wait.
  const silent = createServer(() => {});
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const { port } = silent.address() as AddressInfo;
  try {
    expect(
      await forwardEnvelope(new Uint8Array([1]), `http://key@127.0.0.1:${port}/1`, {
        timeoutMs: 50,
      }),
    ).toEqual({ status: "unreachable", reason: "TimeoutError" });
  } finally {
    silent.closeAllConnections();
    await new Promise((resolve) => silent.close(resolve));
  }
});

test("a browser that sent a tap's selector with a person's name: the tunnel keeps no name", () => {
  const [, items] = prepared(
    envelopeOf(
      browserHeader,
      [
        { type: "event" },
        {
          message: "boom",
          breadcrumbs: [
            {
              category: "ui.click",
              message: 'body > li > button[aria-label="Acties voor Anne de Vries"]',
              data: { "ui.component_name": "AnneRow" },
            },
          ],
        },
      ],
      [
        { type: "transaction" },
        {
          type: "transaction",
          contexts: { trace: { data: { "lcp.element": 'p[title="Anne de Vries"]' } } },
        },
      ],
    ),
  );
  const [event, transaction] = items.map(([, payload]) => payload) as [
    { breadcrumbs: unknown },
    { contexts: unknown },
  ];
  expect(event.breadcrumbs).toEqual([
    { category: "ui.click", message: "body > li > button[aria-label]" },
  ]);
  expect(transaction.contexts).toEqual({ trace: { data: { "lcp.element": "p[title]" } } });
  expect(JSON.stringify(items)).not.toContain("Anne");
});

// The build's commit, as the browser bundles carry it: an installed app keeps its own release
// until it is updated, so an old phone's error stays under the old release.
const BROWSER_COMMIT = "0123456789abcdef0123456789abcdef01234567";

test("keeps the browser's release when it is a full commit: event, transaction, session, header", () => {
  const [header, items] = prepared(
    envelopeOf(
      { ...browserHeader, trace: { ...browserHeader.trace, release: BROWSER_COMMIT } },
      [{ type: "event" }, { message: "m", environment: "x", release: BROWSER_COMMIT }],
      [{ type: "transaction" }, { type: "transaction", release: BROWSER_COMMIT }],
      [{ type: "session" }, { sid: "s1", attrs: { release: BROWSER_COMMIT, environment: "x" } }],
      [{ type: "sessions" }, { aggregates: [], attrs: { release: BROWSER_COMMIT } }],
    ),
  );
  expect((header.trace as { release?: unknown }).release).toBe(BROWSER_COMMIT);
  expect(items.map(([, payload]) => payload)).toEqual([
    { message: "m", environment: "staging", release: BROWSER_COMMIT },
    { type: "transaction", environment: "staging", release: BROWSER_COMMIT },
    { sid: "s1", attrs: { release: BROWSER_COMMIT, environment: "staging" } },
    { aggregates: [], attrs: { release: BROWSER_COMMIT, environment: "staging" } },
  ]);
});

test.each([
  ["dev", "dev"],
  ["a short commit", "0123456"],
  ["upper case", BROWSER_COMMIT.toUpperCase()],
  ["a commit with more after it", `${BROWSER_COMMIT}x`],
  ["an address", "someone@example.test"],
  ["not a string", 42],
])("uses the server's release for a browser release that is %s", (_, release) => {
  const [header, items] = prepared(
    envelopeOf(
      { ...browserHeader, trace: { ...browserHeader.trace, release } },
      [{ type: "event" }, { message: "m", release }],
      [{ type: "session" }, { sid: "s1", attrs: { release } }],
    ),
  );
  expect((header.trace as { release?: unknown }).release).toBe("abc123");
  expect(items.map(([, payload]) => payload)).toEqual([
    { message: "m", environment: "staging", release: "abc123" },
    { sid: "s1", attrs: { release: "abc123", environment: "staging" } },
  ]);
});

test("drops sdkProcessingMetadata from every item type and from the header", () => {
  const metadata = { sdkProcessingMetadata: { note: "meta@example.test" } };
  const [header, items] = prepared(
    envelopeOf(
      {
        ...browserHeader,
        sdk: { ...browserHeader.sdk, ...metadata },
        trace: { ...browserHeader.trace, ...metadata },
      },
      [{ type: "session" }, { sid: "s1", ...metadata }],
      [{ type: "sessions" }, { aggregates: [], ...metadata }],
      [{ type: "client_report" }, { timestamp: 1, ...metadata }],
      [{ type: "transaction" }, { type: "transaction", ...metadata }],
    ),
  );
  const raw = JSON.stringify([header, items]);
  expect(raw).not.toContain("sdkProcessingMetadata");
  expect(raw).not.toContain("meta@example.test");
  expect(header.sdk).toEqual(browserHeader.sdk);
});
