import { expect, test } from "vitest";
import { checkHealth } from "./health-check.ts";

const newCommit = "b".repeat(40);
const oldCommit = "a".repeat(40);
const restartedAt = new Date("2027-03-01T20:00:00Z");
const after = "2027-03-01T20:00:30.000Z";
const before = "2027-03-01T19:59:30.000Z";

type Answer = { status: number; body: unknown } | Error;

/** A fetch that gives the answers in turn (the last one again when they run out). */
function fakeFetch(answers: Answer[]) {
  const requests: { url: string; headers: Headers }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    const answer = answers.length > 1 ? answers.shift()! : answers[0]!;
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const health = (commit: string, lastHeartbeatAt: string | null, status = "ok") => ({
  status: status === "ok" ? 200 : 503,
  body: {
    status,
    commit,
    checkedAt: after,
    database: { reachable: true },
    worker: { lastHeartbeatAt },
  },
});

test("waits until the new commit answers", async () => {
  const { fetch, requests } = fakeFetch([
    health(oldCommit, after),
    new Error("connect ECONNREFUSED"),
    health(oldCommit, after),
    health(newCommit, after),
  ]);
  await checkHealth({
    url: "https://staging.example/",
    commit: newCommit,
    heartbeatAfter: restartedAt,
    timeoutMs: 5_000,
    intervalMs: 1,
    fetch,
  });
  expect(requests).toHaveLength(4);
  for (const request of requests) {
    expect(request.url).toMatch(/^https:\/\/staging\.example\/api\/health\?nocache=\w+$/);
    expect(request.headers.get("cache-control")).toBe("no-cache");
  }
  // Every request has its own cache-busting value.
  expect(new Set(requests.map((r) => r.url)).size).toBe(4);
});

test("does not accept a heartbeat from before the restart", async () => {
  const { fetch, requests } = fakeFetch([
    health(newCommit, before),
    health(newCommit, null),
    health(newCommit, restartedAt.toISOString()),
    health(newCommit, after),
  ]);
  await checkHealth({
    url: "https://staging.example",
    commit: newCommit,
    heartbeatAfter: restartedAt,
    timeoutMs: 5_000,
    intervalMs: 1,
    fetch,
  });
  expect(requests).toHaveLength(4);
});

test("does not accept a degraded status", async () => {
  const { fetch, requests } = fakeFetch([
    health(newCommit, after, "degraded"),
    { status: 200, body: { ...health(newCommit, after).body, status: "degraded" } },
    health(newCommit, after),
  ]);
  await checkHealth({
    url: "https://staging.example",
    commit: newCommit,
    heartbeatAfter: restartedAt,
    timeoutMs: 5_000,
    intervalMs: 1,
    fetch,
  });
  expect(requests).toHaveLength(3);
});

test("times out with the last status and body", async () => {
  const { fetch } = fakeFetch([health(oldCommit, after), health(newCommit, after, "degraded")]);
  const started = Date.now();
  const error = await checkHealth({
    url: "https://staging.example",
    commit: newCommit,
    heartbeatAfter: restartedAt,
    timeoutMs: 200,
    intervalMs: 20,
    fetch,
  }).then(
    () => undefined,
    (e: unknown) => e as Error,
  );
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(error).toBeInstanceOf(Error);
  expect(error?.message).toContain("https://staging.example/api/health");
  expect(error?.message).toContain("HTTP 503");
  expect(error?.message).toContain('"status":"degraded"');
  expect(error?.message).toContain(newCommit.slice(0, 7));
});

test("a timeout without any answer names the network error", async () => {
  const { fetch } = fakeFetch([new Error("getaddrinfo ENOTFOUND staging.example")]);
  await expect(
    checkHealth({
      url: "https://staging.example",
      commit: newCommit,
      heartbeatAfter: restartedAt,
      timeoutMs: 50,
      intervalMs: 10,
      fetch,
    }),
  ).rejects.toThrow(/ENOTFOUND/);
});

test("names what is wrong with an answer that is not the new release", async () => {
  const { fetch } = fakeFetch([health(oldCommit, before)]);
  await expect(
    checkHealth({
      url: "https://staging.example",
      commit: newCommit,
      heartbeatAfter: restartedAt,
      timeoutMs: 50,
      intervalMs: 10,
      fetch,
    }),
  ).rejects.toThrow(/commit aaaaaaa instead of bbbbbbb.*heartbeat/s);
});

test("a last request without an answer keeps the last real answer in the error", async () => {
  const { fetch } = fakeFetch([
    health(newCommit, after, "degraded"),
    new Error("The operation was aborted due to timeout"),
  ]);
  const error = await checkHealth({
    url: "https://staging.example",
    commit: newCommit,
    heartbeatAfter: restartedAt,
    timeoutMs: 50,
    intervalMs: 10,
    fetch,
  }).then(
    () => undefined,
    (e: unknown) => e as Error,
  );
  expect(error?.message).toContain("HTTP 503");
  expect(error?.message).toContain('"status":"degraded"');
  expect(error?.message).toContain("aborted due to timeout");
});

test("each request may take up to 10 s, also when the timeout is nearly over", async () => {
  const timeouts: number[] = [];
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  const spy = (ms: number) => {
    timeouts.push(ms);
    return realTimeout(ms);
  };
  AbortSignal.timeout = spy;
  try {
    const { fetch } = fakeFetch([health(oldCommit, after)]);
    await checkHealth({
      url: "https://staging.example",
      commit: newCommit,
      heartbeatAfter: restartedAt,
      timeoutMs: 30,
      intervalMs: 10,
      fetch,
    }).catch(() => undefined);
  } finally {
    AbortSignal.timeout = realTimeout;
  }
  expect(timeouts.length).toBeGreaterThan(1);
  expect(new Set(timeouts)).toEqual(new Set([10_000]));
});
