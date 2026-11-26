import { expect, test } from "vitest";
import { scrubBreadcrumb, scrubEvent } from "./scrub-event";

test("scrubs every string, drops request headers, cookies, body, query and user fields but id", () => {
  const event = {
    message: "send to noor@example.test failed",
    user: {
      id: "0190...",
      email: "noor@example.test",
      ip_address: "203.0.113.9",
      username: "Noor",
    },
    request: {
      url: "https://padvinder.test/api/x",
      headers: { cookie: "s=1" },
      cookies: { s: "1" },
      data: '{"email":"a@b.test"}',
      query_string: "email=a@b.test",
    },
    spans: [{ description: "select * from users where email = 'c@d.test'" }],
    breadcrumbs: [{ message: "GET /api/x?email=e@f.test" }],
    extra: { nested: [{ deep: "g@h.test" }] },
  };
  const result = scrubEvent(event);
  expect(JSON.stringify(result)).not.toMatch(/@(example|b|d|f|h)\.test/);
  expect(result.user).toEqual({ id: "0190..." });
  expect(result.request).toEqual({ url: "https://padvinder.test/api/x" });
  expect(result.message).toBe("send to [email] failed");
});

test("leaves the input alone and keeps keys, numbers and booleans", () => {
  const event = { extra: { "x@y.test": 1, ok: true, none: null }, message: "m@n.test" };
  const result = scrubEvent(event);
  expect(event.message).toBe("m@n.test");
  expect(result).toEqual({ extra: { "x@y.test": 1, ok: true, none: null }, message: "[email]" });
});

test("an event without a user or request gets none", () => {
  expect(scrubEvent({ message: "x" })).toEqual({ message: "x" });
});

test("survives cycles and depth", () => {
  const cyclic: Record<string, unknown> = { name: "a@b.test" };
  cyclic.self = cyclic;
  let deep: Record<string, unknown> = { leaf: "c@d.test" };
  for (let i = 0; i < 20; i++) deep = { child: deep };
  const result = scrubEvent({ extra: { cyclic, deep } });
  const text = JSON.stringify(result);
  expect(text).toContain('"[circular]"');
  expect(text).toContain('"[depth]"');
  expect(text).not.toMatch(/@(b|d)\.test/);
});

test("drops the user agent from the trace context and from every span", () => {
  const result = scrubEvent({
    contexts: { trace: { data: { "user_agent.original": "UA-MARKER", "url.path": "/api/me" } } },
    spans: [{ data: { "user_agent.original": "UA-MARKER", "sentry.op": "db" } }, { op: "x" }],
  });
  expect(result).toEqual({
    contexts: { trace: { data: { "url.path": "/api/me" } } },
    spans: [{ data: { "sentry.op": "db" } }, { op: "x" }],
  });
});

test("depth: 12 levels below the event are kept, the 13th becomes a marker", () => {
  const nest = (levels: number): Record<string, unknown> =>
    levels === 0 ? { leaf: "x" } : { child: nest(levels - 1) };
  expect(JSON.stringify(scrubEvent(nest(12)))).not.toContain("[depth]");
  expect(JSON.stringify(scrubEvent(nest(12)))).toContain('"leaf":"x"');
  expect(JSON.stringify(scrubEvent(nest(13)))).toContain('"child":"[depth]"');
});

test("a value seen twice (not a cycle) is kept twice", () => {
  const shared = { v: "e@f.test" };
  expect(scrubEvent({ extra: { a: shared, b: shared } })).toEqual({
    extra: { a: { v: "[email]" }, b: { v: "[email]" } },
  });
});

test("scrubBreadcrumb scrubs the message and data, and cuts the query from a URL", () => {
  const result = scrubBreadcrumb({
    category: "http",
    message: "GET /api/x?email=e@f.test",
    data: { url: "/api/x?email=e@f.test", status_code: 200 },
  });
  expect(result).toEqual({
    category: "http",
    message: "GET /api/x?email=[email]",
    data: { url: "/api/x", status_code: 200 },
  });
});

const QUERY = "?email=noor%40example.test&phone=0612345678#frag";

test.each(["url.path", "url.full", "http.target", "http.url", "url"])(
  "cuts the query and fragment from %s in span data, trace data and breadcrumb data",
  (key) => {
    const result = scrubEvent({
      contexts: { trace: { data: { [key]: `/api/version${QUERY}` } } },
      spans: [{ data: { [key]: `http://127.0.0.1:4100/api/version${QUERY}` } }],
      breadcrumbs: [{ data: { [key]: `/api/version${QUERY}` } }],
    });
    expect(result).toEqual({
      contexts: { trace: { data: { [key]: "/api/version" } } },
      spans: [{ data: { [key]: "http://127.0.0.1:4100/api/version" } }],
      breadcrumbs: [{ data: { [key]: "/api/version" } }],
    });
  },
);

test("cuts the query from request.url and from the url in the pino context", () => {
  const result = scrubEvent({
    request: { url: `https://padvinder.test/api/version${QUERY}`, method: "GET" },
    contexts: {
      pino: { req: { method: "GET", url: `/api/version${QUERY}` }, url: `/api/x${QUERY}` },
    },
  });
  expect(result).toEqual({
    request: { url: "https://padvinder.test/api/version", method: "GET" },
    contexts: { pino: { req: { method: "GET", url: "/api/version" }, url: "/api/x" } },
  });
});

test("drops the query and fragment span attributes", () => {
  const result = scrubEvent({
    contexts: { trace: { data: { "url.query": "?email=a", "http.query": "email=a", ok: 1 } } },
    spans: [{ data: { "url.query": "?email=a", "url.fragment": "x", ok: 2 } }],
  });
  expect(result).toEqual({
    contexts: { trace: { data: { ok: 1 } } },
    spans: [{ data: { ok: 2 } }],
  });
});

test("scrubs a percent-encoded address, in any string, in upper and lower case", () => {
  const result = scrubEvent({
    contexts: { trace: { data: { "url.path": "/api/users/noor%40example.test" } } },
    transaction: "GET /api/users/noor%40Example.test",
    message: "lookup of noor%40example.test and sam%40example.test failed",
    request: { url: "https://padvinder.test/api/users/sam%40example.test" },
  });
  const text = JSON.stringify(result);
  expect(text).not.toContain("example.test");
  expect(text).not.toContain("Example.test");
  expect(result.contexts.trace.data["url.path"]).toBe("/api/users/[email]");
  expect(result.message).toBe("lookup of [email] and [email] failed");
});

test("scrubBreadcrumb scrubs a percent-encoded address", () => {
  expect(scrubBreadcrumb({ message: "GET /api/users/noor%40example.test" })).toEqual({
    message: "GET /api/users/[email]",
  });
});

test("passes sdkProcessingMetadata through by reference, unscrubbed", () => {
  const metadata = { normalizedRequest: { url: "/api/x?email=a@b.test" }, big: [1, 2, 3] };
  const result = scrubEvent({ message: "m", sdkProcessingMetadata: metadata });
  expect(result.sdkProcessingMetadata).toBe(metadata);
  expect(result.message).toBe("m");
});
