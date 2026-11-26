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

test("a value seen twice (not a cycle) is kept twice", () => {
  const shared = { v: "e@f.test" };
  expect(scrubEvent({ extra: { a: shared, b: shared } })).toEqual({
    extra: { a: { v: "[email]" }, b: { v: "[email]" } },
  });
});

test("scrubBreadcrumb scrubs the message and data", () => {
  const result = scrubBreadcrumb({
    category: "http",
    message: "GET /api/x?email=e@f.test",
    data: { url: "/api/x?email=e@f.test", status_code: 200 },
  });
  expect(result).toEqual({
    category: "http",
    message: "GET /api/x?email=[email]",
    data: { url: "/api/x?email=[email]", status_code: 200 },
  });
});
