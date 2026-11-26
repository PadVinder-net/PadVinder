import { startFakeSentry } from "@padvinder/monitoring/testing";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createTestApp, type TestApp } from "../testing/login";
import { testEnv } from "../test-env";

let fake: Awaited<ReturnType<typeof startFakeSentry>>;
let other: Awaited<ReturnType<typeof startFakeSentry>>;
let ctx: TestApp;
let off: TestApp;

beforeAll(async () => {
  fake = await startFakeSentry();
  other = await startFakeSentry();
  ctx = await createTestApp(
    {},
    {
      monitoring: {
        dsn: other.dsn,
        browserDsn: fake.dsn,
        environment: "staging",
        release: "rel-1",
      },
    },
  );
  off = await createTestApp(
    {},
    {
      monitoring: {
        dsn: other.dsn,
        browserDsn: undefined,
        environment: "staging",
        release: "rel-1",
      },
    },
  );
});

afterAll(async () => {
  await ctx?.close();
  await off?.close();
  await fake?.close();
  await other?.close();
});

beforeEach(() => {
  fake.answerWith(200);
});

let addressCounter = 0;
/** A fresh client address per test, so the rate limit of one test does not reach another. */
function newAddress(): string {
  addressCounter += 1;
  return `198.51.100.${addressCounter}`;
}

const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) UA-MARKER";

function browserEnvelope(release = "browser"): string {
  const lines: unknown[] = [
    {
      event_id: "9ec79c33ec9942ab8353589fcb2e04dc",
      sent_at: "2026-11-26T10:00:00.000Z",
      dsn: "https://foreignkey@o9.ingest.sentry.io/99",
      sdk: { name: "sentry.javascript.react", version: "11.18.0" },
      trace: { trace_id: "771a43a4192642f0b136d5159a501700", public_key: "foreignkey" },
    },
    { type: "event" },
    {
      event_id: "9ec79c33ec9942ab8353589fcb2e04dc",
      message: "send to noor@example.test failed",
      environment: "production",
      release,
      tags: { service: "app" },
      user: { id: "u1", ip_address: "{{auto}}", email: "x@y.test" },
      request: { url: "https://padvinder.test/app/", headers: { "User-Agent": "UA-MARKER" } },
      breadcrumbs: [
        { category: "fetch", data: { url: "/api/members?email=a%40b.test" } },
        { category: "navigation", message: "to /app/x?email=a%40b.test" },
      ],
    },
    { type: "replay_recording", length: 4 },
  ];
  const replay = "\u0001\u0002\u0003\u0004";
  const session = [
    { type: "session" },
    {
      sid: "s1",
      status: "ok",
      attrs: { release, environment: "production", user_agent: PHONE_UA },
    },
  ];
  return [
    ...lines.map((line) => JSON.stringify(line)),
    replay,
    ...session.map((line) => JSON.stringify(line)),
  ].join("\n");
}

function postEnvelope(app: TestApp, payload: string, headers: Record<string, string> = {}) {
  return app.app.inject({
    method: "POST",
    url: "/api/sentry-tunnel",
    headers: {
      origin: testEnv.PUBLIC_ORIGIN,
      "content-type": "text/plain;charset=UTF-8",
      "x-forwarded-for": newAddress(),
      ...headers,
    },
    payload,
  });
}

test("forwards a scrubbed envelope once, to our DSN, without the phone's headers", async () => {
  const before = fake.requests().length;
  const res = await postEnvelope(ctx, browserEnvelope(), {
    cookie: "padvinder.session_token=secret-cookie",
    "user-agent": PHONE_UA,
  });
  expect(res.statusCode).toBe(200);

  const requests = fake.requests().slice(before);
  expect(requests).toHaveLength(1);
  const { headers } = requests[0]!;
  expect(headers.cookie).toBeUndefined();
  expect(headers["x-forwarded-for"]).toBeUndefined();
  expect(headers.origin).toBeUndefined();
  expect(headers["user-agent"]).not.toBe(PHONE_UA);
  expect(JSON.stringify(headers)).not.toMatch(/secret-cookie|UA-MARKER|198\.51\.100/);

  const raw = fake.bodies().at(-1)!;
  expect(raw).not.toMatch(/example\.test|UA-MARKER|a%40b\.test|y\.test|foreignkey|replay/);
  const [header, items] = fake.envelopes().at(-1)!;
  expect(header.dsn).toBe(fake.dsn);
  expect(items.map(([itemHeader]) => itemHeader.type)).toEqual(["event", "session"]);
  const [event] = fake.events().slice(-1);
  expect(event).toMatchObject({
    environment: "staging",
    release: "rel-1",
    user: { id: "u1" },
    tags: { service: "app" },
    message: "send to [email] failed",
  });
  expect(event!.user).toEqual({ id: "u1" });
  expect(items[1]![1]).toMatchObject({ attrs: { environment: "staging", release: "rel-1" } });
});

test("keeps the release of a browser that sends its build's full commit", async () => {
  // An installed app runs its old build until it is updated: its errors stay under that release.
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const res = await postEnvelope(ctx, browserEnvelope(commit));
  expect(res.statusCode).toBe(200);
  const [, items] = fake.envelopes().at(-1)!;
  expect(fake.events().at(-1)).toMatchObject({ environment: "staging", release: commit });
  expect(items[1]![1]).toMatchObject({ attrs: { environment: "staging", release: commit } });
});

test("works without a cookie and with the SDK's own content type", async () => {
  const res = await postEnvelope(ctx, browserEnvelope(), {
    "content-type": "application/x-sentry-envelope",
  });
  expect(res.statusCode).toBe(200);
});

test("answers 400 to a body that is not an envelope and forwards nothing", async () => {
  const before = fake.requests().length;
  const res = await postEnvelope(ctx, "this is not an envelope");
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ code: "invalid_request" });
  expect(fake.requests()).toHaveLength(before);
});

test("answers 413 to a body over 200 KB", async () => {
  const before = fake.requests().length;
  const res = await postEnvelope(ctx, "x".repeat(200 * 1024 + 1));
  expect(res.statusCode).toBe(413);
  expect(fake.requests()).toHaveLength(before);
});

test("accepts a body of exactly 200 KB", async () => {
  const envelope = browserEnvelope();
  const res = await postEnvelope(ctx, envelope.padEnd(200 * 1024, " "));
  // Trailing spaces make the last item's JSON longer, not invalid: JSON.parse allows them.
  expect(res.statusCode).toBe(200);
});

test("answers 429 to the 121st envelope in a minute from one address", async () => {
  const address = newAddress();
  for (let i = 0; i < 120; i++) {
    const res = await postEnvelope(ctx, browserEnvelope(), { "x-forwarded-for": address });
    expect(res.statusCode).toBe(200);
  }
  const before = fake.requests().length;
  const refused = await postEnvelope(ctx, browserEnvelope(), { "x-forwarded-for": address });
  expect(refused.statusCode).toBe(429);
  expect(refused.json()).toMatchObject({ code: "too_many_requests" });
  expect(fake.requests()).toHaveLength(before);
  // Another address still gets through.
  expect((await postEnvelope(ctx, browserEnvelope())).statusCode).toBe(200);
});

test("answers 204 without a DSN and forwards nothing", async () => {
  const before = fake.requests().length;
  const res = await postEnvelope(off, browserEnvelope());
  expect(res.statusCode).toBe(204);
  expect(res.body).toBe("");
  expect(fake.requests()).toHaveLength(before);
});

test("answers 502 when Sentry fails", async () => {
  fake.answerWith(500);
  const res = await postEnvelope(ctx, browserEnvelope());
  expect(res.statusCode).toBe(502);
  expect(res.json()).toMatchObject({ code: "sentry_unavailable" });
});

test("answers 502 when Sentry cannot be reached", async () => {
  const closed = await startFakeSentry();
  await closed.close();
  const app = await createTestApp(
    {},
    {
      monitoring: {
        dsn: other.dsn,
        browserDsn: closed.dsn,
        environment: "staging",
        release: "rel-1",
      },
    },
  );
  try {
    expect((await postEnvelope(app, browserEnvelope())).statusCode).toBe(502);
  } finally {
    await app.close();
  }
});

test("passes Sentry's 429 and its rate limit headers on", async () => {
  fake.answerWith(429, { "retry-after": "60", "x-sentry-rate-limits": "60:error:key" });
  const res = await postEnvelope(ctx, browserEnvelope());
  expect(res.statusCode).toBe(429);
  expect(res.headers["retry-after"]).toBe("60");
  expect(res.headers["x-sentry-rate-limits"]).toBe("60:error:key");
});

test("refuses a foreign Origin", async () => {
  const res = await postEnvelope(ctx, browserEnvelope(), { origin: "https://evil.example" });
  expect(res.statusCode).toBe(403);
});

test("has no GET", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/sentry-tunnel" });
  expect(res.statusCode).toBe(404);
});

test("takes a body without a content type", async () => {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/sentry-tunnel",
    headers: { origin: testEnv.PUBLIC_ORIGIN, "x-forwarded-for": newAddress() },
    payload: Buffer.from(browserEnvelope()),
  });
  expect(res.statusCode).toBe(200);
});

test("with only the server DSN set the tunnel answers 204 and forwards nothing", async () => {
  const onlyServer = await createTestApp(
    {},
    { monitoring: { dsn: other.dsn, browserDsn: undefined, environment: "staging", release: "r" } },
  );
  try {
    const res = await postEnvelope(onlyServer, browserEnvelope());
    expect(res.statusCode).toBe(204);
    expect(other.requests()).toHaveLength(0);
  } finally {
    await onlyServer.close();
  }
});

test("envelopes reach the browser project's server only, with its DSN in the header", async () => {
  const before = fake.requests().length;
  const res = await postEnvelope(ctx, browserEnvelope());
  expect(res.statusCode).toBe(200);
  expect(other.requests()).toHaveLength(0);
  expect(fake.requests().length).toBe(before + 1);
  expect(fake.envelopes().at(-1)![0].dsn).toBe(fake.dsn);
});
