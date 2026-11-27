import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { testSentryConnection } from "./connection-test";
import { startFakeSentry, startIpv6OnlyFakeSentry } from "./testing";

let fake: Awaited<ReturnType<typeof startFakeSentry>>;
beforeAll(async () => {
  fake = await startFakeSentry();
});
afterAll(() => fake?.close());
beforeEach(() => fake.answerWith(200));

test("over IPv4 the fake takes one event with the test message and the service tag", async () => {
  const before = fake.events().length;
  expect(await testSentryConnection(fake.dsn, 4, { service: "api" })).toEqual({
    family: 4,
    status: 200,
  });
  const events = fake.events().slice(before);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    level: "info",
    platform: "node",
    message: "Sentry connection test over IPv4",
    tags: { service: "api" },
  });
  const request = fake.requests().at(-1)!;
  expect(request.url).toMatch(/^\/api\/1\/envelope\/\?sentry_version=7&sentry_key=public$/);
  expect(request.headers["content-type"]).toBe("application/x-sentry-envelope");
});

test("the envelope header holds the DSN, the event ID and when it was sent", async () => {
  await testSentryConnection(fake.dsn, 4);
  const [header, items] = fake.envelopes().at(-1)!;
  expect(header).toMatchObject({
    dsn: fake.dsn,
    event_id: expect.stringMatching(/^[0-9a-f]{32}$/),
  });
  expect(typeof header.sent_at).toBe("string");
  expect(items[0]![0]).toEqual({ type: "event" });
  expect((items[0]![1] as { event_id: string }).event_id).toBe(header.event_id);
});

test("a refusal gives the status and the page's title", async () => {
  fake.answerWith(
    403,
    { "content-type": "text/html" },
    "<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body>No.</body></html>",
  );
  expect(await testSentryConnection(fake.dsn, 4)).toEqual({
    family: 4,
    status: 403,
    answer: "403 Forbidden",
  });
});

test("a refusal without a title gives the first 200 characters of the body, scrubbed", async () => {
  fake.answerWith(429, {}, `{"detail":"slow down noor@example.test"}${"x".repeat(300)}`);
  const result = await testSentryConnection(fake.dsn, 4);
  expect(result.status).toBe(429);
  expect(result.answer).not.toContain("noor@example.test");
  expect(result.answer!.startsWith('{"detail":"slow down')).toBe(true);
  expect(result.answer!.length).toBeLessThanOrEqual(200);
});

test("the answer never holds the DSN's key", async () => {
  fake.answerWith(403, {}, "Your client may not get /api/1/envelope/?sentry_key=public here");
  const result = await testSentryConnection(fake.dsn, 4);
  expect(JSON.stringify(result)).not.toContain("public");
});

test("a key or address that crosses character 200 never survives in part", async () => {
  // A made-up key of one repeated letter: low entropy, so it never looks like a secret to gitleaks.
  const key = "k".repeat(16);
  const dsn = fake.dsn.replace("public@", `${key}@`);
  fake.answerWith(403, {}, `${"x".repeat(180)}?sentry_key=${key}&more`);
  const withKey = await testSentryConnection(dsn, 4);
  expect(withKey.status).toBe(403);
  // The key starts at character 192, so a cut before cleaning would leave "kkkkkkkk".
  expect(withKey.answer).not.toContain("kkkk");
  expect(withKey.answer!.length).toBeLessThanOrEqual(200);
  fake.answerWith(403, {}, `${"x".repeat(190)} noor@example.test wrote`);
  const withAddress = await testSentryConnection(dsn, 4);
  expect(withAddress.answer).not.toContain("noor");
});

test("the test event carries the environment and the release when given", async () => {
  await testSentryConnection(fake.dsn, 4, {
    service: "api",
    environment: "staging",
    release: "rel-1",
  });
  expect(fake.events().at(-1)).toMatchObject({ environment: "staging", release: "rel-1" });
});

test("an error that request() throws at once is unreachable too", async () => {
  // Node validates the family when it looks the host name up, inside request().
  const result = await testSentryConnection(fake.dsn.replace("127.0.0.1", "localhost"), 5 as 4);
  expect(result).toMatchObject({ status: "unreachable", answer: expect.any(String) });
});

test("over IPv4 a host that only listens on IPv6 is unreachable", async (context) => {
  const ipv6 = await startIpv6OnlyFakeSentry();
  if (ipv6 === null) return context.skip("this machine has no IPv6 loopback");
  try {
    expect(await testSentryConnection(ipv6.dsn, 6)).toEqual({ family: 6, status: 200 });
    expect(await testSentryConnection(ipv6.dsn, 4)).toEqual({
      family: 4,
      status: "unreachable",
      answer: expect.stringMatching(/^E[A-Z]+$/),
    });
  } finally {
    await ipv6.close();
  }
});

test("over IPv6 a host that only listens on IPv4 is unreachable, with the error code", async () => {
  // An address literal skips the lookup, so the family only counts for a host name.
  const ipv4 = await startFakeSentry({ dsnHost: "localhost" });
  try {
    expect(await testSentryConnection(ipv4.dsn, 4)).toEqual({ family: 4, status: 200 });
    const result = await testSentryConnection(ipv4.dsn, 6);
    expect(result).toEqual({
      family: 6,
      status: "unreachable",
      answer: expect.stringMatching(/^E[A-Z]+$/),
    });
  } finally {
    await ipv4.close();
  }
});

test("a closed port is unreachable", async () => {
  const closed = await startFakeSentry();
  await closed.close();
  expect(await testSentryConnection(closed.dsn, 4)).toEqual({
    family: 4,
    status: "unreachable",
    answer: "ECONNREFUSED",
  });
});

test("no answer within the timeout is unreachable with TimeoutError", async () => {
  const silent = createServer(() => {});
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const { port } = silent.address() as AddressInfo;
  try {
    expect(
      await testSentryConnection(`http://key@127.0.0.1:${port}/1`, 4, { timeoutMs: 100 }),
    ).toEqual({ family: 4, status: "unreachable", answer: "TimeoutError" });
  } finally {
    silent.closeAllConnections();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  }
});

test("a value that is not a DSN never throws", async () => {
  expect(await testSentryConnection("not a dsn", 6)).toEqual({
    family: 6,
    status: "unreachable",
    answer: "DsnError",
  });
});
